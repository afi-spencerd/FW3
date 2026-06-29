<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  type CycleCount,
  type InventoryItem,
  isStockableKind,
  type LocatedStockStatus,
  LOCATED_STOCK_STATUSES,
  type Location,
  PERMISSIONS,
  scopeLeafLocationIds,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const props = defineProps<{ id: string }>();
const router = useRouter();
const auth = useAuthStore();
const canManage = auth.hasPermission(PERMISSIONS.CYCLE_COUNT_MANAGE);

const count = ref<CycleCount | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = ref(false);

// lineId -> entered count
const counts = reactive<Record<string, string>>({});

const isOpen = computed(() => count.value?.status === "OPEN");

// Found-item entry
const items = ref<InventoryItem[]>([]);
const allLocations = ref<Location[]>([]);
const leafLocations = ref<Location[]>([]);
const found = reactive({
  itemId: "",
  status: "INV" as LocatedStockStatus,
  locationId: "",
  quantity: "0",
});

// Found items may only be assigned to locations within this count's scope.
const scopeLocations = computed(() => {
  const ids = scopeLeafLocationIds(
    allLocations.value,
    count.value?.scopeLocationId ?? null,
  );
  return ids === null
    ? leafLocations.value
    : leafLocations.value.filter((l) => ids.includes(l.id));
});

async function load(): Promise<void> {
  error.value = null;
  try {
    count.value = await api.getCycleCount(props.id);
    for (const l of count.value.lines) {
      counts[l.id] = l.countedQty ?? "";
    }
    if (isOpen.value && canManage && items.value.length === 0) {
      const [inv, locs] = await Promise.all([
        api.listInventory({ pageSize: 200 }),
        api.listLocations(),
      ]);
      items.value = inv.items;
      allLocations.value = locs;
      leafLocations.value = locs.filter((l) => l.active && isStockableKind(l.kind));
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

async function save(): Promise<void> {
  if (!count.value) return;
  busy.value = true;
  error.value = null;
  notice.value = null;
  try {
    const lines = count.value.lines
      .filter((l) => (counts[l.id] ?? "").trim() !== "")
      .map((l) => ({ lineId: l.id, countedQty: (counts[l.id] ?? "").trim() }));
    count.value = await api.recordCycleCounts(props.id, { lines, found: [] });
    for (const l of count.value.lines) counts[l.id] = l.countedQty ?? "";
    notice.value = "Counts saved.";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Save failed";
  } finally {
    busy.value = false;
  }
}

async function addFound(): Promise<void> {
  if (!found.itemId || !found.locationId) return;
  busy.value = true;
  error.value = null;
  try {
    count.value = await api.recordCycleCounts(props.id, {
      lines: [],
      found: [
        {
          itemId: found.itemId,
          status: found.status,
          locationId: found.locationId,
          countedQty: found.quantity,
        },
      ],
    });
    for (const l of count.value.lines) counts[l.id] = l.countedQty ?? "";
    found.itemId = "";
    found.locationId = "";
    found.quantity = "0";
    notice.value = "Found item added.";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Add failed";
  } finally {
    busy.value = false;
  }
}

async function post(): Promise<void> {
  if (!confirm("Post this count? Variances will be applied as inventory adjustments.")) return;
  busy.value = true;
  error.value = null;
  try {
    count.value = await api.postCycleCount(props.id);
    notice.value = "Count posted — variances applied as adjustments.";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Post failed";
  } finally {
    busy.value = false;
  }
}

async function cancel(): Promise<void> {
  if (!confirm("Cancel this count?")) return;
  busy.value = true;
  error.value = null;
  try {
    count.value = await api.cancelCycleCount(props.id);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Cancel failed";
  } finally {
    busy.value = false;
  }
}

function varianceStyle(v: string | null): Record<string, string> {
  if (v === null || v === "0") return {};
  return { color: Number(v) > 0 ? "var(--ok)" : "var(--danger)", fontWeight: "600" };
}

onMounted(load);
</script>

<template>
  <div class="container" style="max-width: 920px">
    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="notice" class="banner ok">{{ notice }}</div>

    <div v-if="count" class="panel">
      <div class="toolbar">
        <h2 style="margin: 0">Cycle count {{ count.reference }}</h2>
        <span class="spacer" />
        <button @click="router.push({ name: 'cycle-counts' })">Back</button>
      </div>
      <div class="summary" style="margin-bottom: 1rem">
        <div class="metric"><div class="label">Status</div><div class="value" style="font-size: 1rem">{{ count.status }}</div></div>
        <div class="metric"><div class="label">Scope</div><div class="value" style="font-size: 1rem">{{ count.scopeLabel }}</div></div>
        <div class="metric"><div class="label">Blind</div><div class="value" style="font-size: 1rem">{{ count.blind ? "Yes" : "No" }}</div></div>
        <div class="metric"><div class="label">Counted</div><div class="value" style="font-size: 1rem">{{ count.countedCount }} / {{ count.lineCount }}</div></div>
        <div class="metric"><div class="label">Variances</div><div class="value" style="font-size: 1rem">{{ count.varianceCount }}</div></div>
      </div>
      <p v-if="count.note" class="inactive">{{ count.note }}</p>

      <table>
        <thead>
          <tr>
            <th>SKU</th><th>Item</th><th>Location</th><th>Status</th>
            <th class="num">Expected (lb)</th><th class="num">Counted (lb)</th><th class="num">Variance</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in count.lines" :key="l.id">
            <td>{{ l.sku }}</td>
            <td>{{ l.name }}</td>
            <td><span style="font-variant-numeric: tabular-nums">{{ l.locationCode }}</span></td>
            <td>{{ l.status }}</td>
            <td class="num">{{ l.expectedQty ?? "—" }}</td>
            <td class="num">
              <input
                v-if="isOpen && canManage"
                v-model="counts[l.id]"
                inputmode="decimal"
                style="text-align: right; max-width: 90px"
              />
              <span v-else>{{ l.countedQty ?? "—" }}</span>
            </td>
            <td class="num" :style="varianceStyle(l.variance)">{{ l.variance ?? "—" }}</td>
          </tr>
          <tr v-if="count.lines.length === 0">
            <td colspan="7" class="inactive">No lines — add found items below.</td>
          </tr>
        </tbody>
      </table>

      <div v-if="isOpen && canManage" class="toolbar" style="margin-top: 0.5rem">
        <button class="primary" :disabled="busy" @click="save">Save counts</button>
        <span class="spacer" />
        <button :disabled="busy" @click="post">Post (apply adjustments)</button>
        <button class="danger" :disabled="busy" @click="cancel">Cancel count</button>
      </div>

      <div v-if="isOpen && canManage" style="margin-top: 1.5rem">
        <h4>Add found item (present but not on the snapshot)</h4>
        <div class="toolbar" style="flex-wrap: wrap">
          <select v-model="found.itemId" style="max-width: 240px">
            <option value="">Item…</option>
            <option v-for="i in items" :key="i.id" :value="i.id">{{ i.sku }} — {{ i.name }}</option>
          </select>
          <select v-model="found.status" style="max-width: 130px">
            <option v-for="s in LOCATED_STOCK_STATUSES" :key="s" :value="s">{{ s }}</option>
          </select>
          <select v-model="found.locationId" style="max-width: 220px">
            <option value="">Location…</option>
            <option v-for="loc in scopeLocations" :key="loc.id" :value="loc.id">{{ loc.code }} — {{ loc.name }}</option>
          </select>
          <input v-model="found.quantity" inputmode="decimal" placeholder="Qty (lb)" style="max-width: 110px" />
          <button :disabled="busy || !found.itemId || !found.locationId" @click="addFound">Add</button>
        </div>
      </div>
    </div>
  </div>
</template>
