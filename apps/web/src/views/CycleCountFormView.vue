<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { type InventoryItem, type Location } from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";

type ScopeType = "ALL" | "LOCATION" | "ITEM";

const router = useRouter();
const locations = ref<Location[]>([]);
const items = ref<InventoryItem[]>([]);
const error = ref<string | null>(null);
const busy = ref(false);

const KIND_INDENT: Record<string, number> = { BUILDING: 0, AISLE: 1, RACK: 2, AREA: 1 };

const form = reactive({
  scopeType: "ALL" as ScopeType,
  scopeLocationId: "",
  scopeItemId: "",
  blind: false,
  note: "",
});

const canSubmit = computed(() => {
  if (form.scopeType === "LOCATION") return !!form.scopeLocationId;
  if (form.scopeType === "ITEM") return !!form.scopeItemId;
  return true;
});

async function load(): Promise<void> {
  try {
    const [locs, inv] = await Promise.all([
      api.listLocations(),
      api.listInventory({ pageSize: 200 }),
    ]);
    locations.value = locs;
    items.value = inv.items;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

async function create(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    const count = await api.createCycleCount({
      scopeLocationId:
        form.scopeType === "LOCATION" ? form.scopeLocationId || undefined : undefined,
      scopeItemId:
        form.scopeType === "ITEM" ? form.scopeItemId || undefined : undefined,
      blind: form.blind,
      note: form.note || undefined,
    });
    await router.push({ name: "cycle-count-detail", params: { id: count.id } });
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Create failed";
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="container" style="max-width: 560px">
    <div class="panel">
      <h2>New cycle count</h2>
      <div v-if="error" class="banner error">{{ error }}</div>

      <div class="field">
        <label>Scope</label>
        <select v-model="form.scopeType">
          <option value="ALL">All locations</option>
          <option value="LOCATION">By location</option>
          <option value="ITEM">By item</option>
        </select>
      </div>

      <div v-if="form.scopeType === 'LOCATION'" class="field">
        <label>Location</label>
        <select v-model="form.scopeLocationId">
          <option value="">Select a location…</option>
          <option v-for="l in locations" :key="l.id" :value="l.id">
            {{ " ".repeat((KIND_INDENT[l.kind] ?? 0) * 3) }}{{ l.code }} — {{ l.name }}
          </option>
        </select>
        <div class="inactive" style="font-size: 0.8rem">
          A building or aisle expands to the racks/areas under it. Only located
          stock (INV &amp; quarantine) is counted.
        </div>
      </div>

      <div v-if="form.scopeType === 'ITEM'" class="field">
        <label>Item</label>
        <select v-model="form.scopeItemId">
          <option value="">Select an item…</option>
          <option v-for="i in items" :key="i.id" :value="i.id">{{ i.sku }} — {{ i.name }}</option>
        </select>
        <div class="inactive" style="font-size: 0.8rem">
          Counts this item across every location it sits in (INV &amp; quarantine).
        </div>
      </div>

      <div class="field">
        <label>
          <input type="checkbox" v-model="form.blind" style="width: auto" />
          Blind count (hide system quantities until posted)
        </label>
      </div>

      <div class="field">
        <label>Note</label>
        <input v-model="form.note" placeholder="e.g. weekly count of aisle A" />
      </div>

      <div class="toolbar">
        <button class="primary" :disabled="busy || !canSubmit" @click="create">
          {{ busy ? "Creating…" : "Create &amp; start counting" }}
        </button>
        <button @click="router.push({ name: 'cycle-counts' })">Cancel</button>
      </div>
    </div>
  </div>
</template>
