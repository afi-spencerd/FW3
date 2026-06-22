<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { RouterLink } from "vue-router";
import {
  type Container,
  ITEM_TYPES,
  type ItemType,
  kgEquivalent,
  PERMISSIONS,
  type InventoryItem,
  STOCK_STATUSES,
  type StockStatus,
} from "@fw3/shared-types";
import { api, ApiError, type ValuationSummary } from "../lib/api";
import { useAuthStore } from "../stores/auth";

// The type filter also offers containers (a separate stock kind, counted each).
type TypeFilter = ItemType | "CONTAINER" | "";

const auth = useAuthStore();

const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  RAW_MATERIAL: "Raw material",
  SEMI_FINISHED: "Base",
  FINISHED_GOOD: "Finished good",
};
const STATUS_LABELS: Record<StockStatus, string> = {
  INV: "Traceable",
  WIP: "WIP",
  QUARANTINE: "Quarantine",
};

const items = ref<InventoryItem[]>([]);
const containers = ref<Container[]>([]);
const valuation = ref<ValuationSummary | null>(null);
// itemId -> position per status (from the stock ledger, not the item master)
const inv = reactive<Record<string, { quantity: string; value: string; avgCost: string }>>({});
const wip = reactive<Record<string, { quantity: string; value: string }>>({});
const quarantine = reactive<Record<string, { quantity: string; value: string }>>({});
const wipTotal = ref("0");
const quarantineTotal = ref("0");

const search = ref("");
const itemType = ref<TypeFilter>("");
const statusFilter = ref<StockStatus | "">("");
const loading = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const packQty = reactive<Record<string, string>>({});

const canPackOff = computed(() =>
  auth.hasPermission(PERMISSIONS.PRODUCTION_EXECUTE),
);

function wipQty(item: InventoryItem): string {
  return wip[item.id]?.quantity ?? "0";
}
function quarantineQty(item: InventoryItem): string {
  return quarantine[item.id]?.quantity ?? "0";
}
function invQty(item: InventoryItem): string {
  return inv[item.id]?.quantity ?? "0";
}
function totalValue(item: InventoryItem): string {
  return (
    Number(inv[item.id]?.value ?? "0") +
    Number(wip[item.id]?.value ?? "0") +
    Number(quarantine[item.id]?.value ?? "0")
  ).toFixed(2);
}

const filteredItems = computed(() => {
  // Hide items entirely when the user filters to containers only.
  if (itemType.value === "CONTAINER") return [];
  return items.value.filter((i) => {
    if (statusFilter.value === "WIP") return Number(wipQty(i)) > 0;
    if (statusFilter.value === "QUARANTINE") return Number(quarantineQty(i)) > 0;
    if (statusFilter.value === "INV") return Number(invQty(i)) > 0;
    return true;
  });
});

// Containers show under "All" or "Container"; they have no WIP/quarantine, so a
// WIP/quarantine status filter excludes them.
const filteredContainers = computed(() => {
  if (itemType.value !== "" && itemType.value !== "CONTAINER") return [];
  if (statusFilter.value === "WIP" || statusFilter.value === "QUARANTINE") return [];
  const q = search.value.trim().toLowerCase();
  return containers.value.filter(
    (c) =>
      !q ||
      c.sku.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.containerType.toLowerCase().includes(q),
  );
});

const containerValueTotal = computed(() =>
  containers.value.reduce((sum, c) => sum + Number(c.totalValue), 0).toFixed(2),
);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [page, positions, val, conts] = await Promise.all([
      api.listInventory({
        search: search.value || undefined,
        // "CONTAINER" isn't an item type — never send it to the items query.
        itemType:
          itemType.value && itemType.value !== "CONTAINER"
            ? itemType.value
            : undefined,
        pageSize: 200,
      }),
      api.stockPositions(),
      api.valuation(),
      api.listContainers(),
    ]);
    items.value = page.items;
    containers.value = conts;
    valuation.value = val;
    for (const key of Object.keys(inv)) delete inv[key];
    for (const key of Object.keys(wip)) delete wip[key];
    for (const key of Object.keys(quarantine)) delete quarantine[key];
    let wipSum = 0;
    let quarantineSum = 0;
    for (const p of positions) {
      if (p.status === "INV") {
        inv[p.itemId] = { quantity: p.quantity, value: p.totalValue, avgCost: p.avgCost };
      } else if (p.status === "WIP") {
        wip[p.itemId] = { quantity: p.quantity, value: p.totalValue };
        wipSum += Number(p.totalValue);
      } else if (p.status === "QUARANTINE") {
        quarantine[p.itemId] = { quantity: p.quantity, value: p.totalValue };
        quarantineSum += Number(p.totalValue);
      }
    }
    wipTotal.value = wipSum.toFixed(2);
    quarantineTotal.value = quarantineSum.toFixed(2);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  } finally {
    loading.value = false;
  }
}


async function packOff(item: InventoryItem): Promise<void> {
  const qty = packQty[item.id];
  if (!qty || Number(qty) <= 0) {
    error.value = "Enter a quantity to pack off.";
    return;
  }
  error.value = null;
  notice.value = null;
  try {
    await api.packOff(item.id, qty);
    packQty[item.id] = "";
    notice.value = `Packed off ${qty} ${item.sku} — moved from WIP to traceable inventory.`;
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Pack-off failed";
  }
}

async function syncQuickBooks(): Promise<void> {
  notice.value = null;
  try {
    const res = await api.qbSync();
    notice.value = `QuickBooks sync queued (job ${res.jobId}).`;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Sync failed";
  }
}

onMounted(load);
</script>

<template>
  <div class="container">
    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="notice" class="banner ok">{{ notice }}</div>

    <div v-if="valuation" class="panel summary" style="margin-bottom: 1rem">
      <div class="metric">
        <div class="label">Items</div>
        <div class="value">{{ valuation.itemCount }}</div>
      </div>
      <div class="metric">
        <div class="label">Traceable value</div>
        <div class="value">${{ valuation.totalValue }}</div>
      </div>
      <div class="metric">
        <div class="label">WIP value</div>
        <div class="value">${{ wipTotal }}</div>
      </div>
      <div class="metric">
        <div class="label">Quarantine value</div>
        <div class="value">${{ quarantineTotal }}</div>
      </div>
      <div class="metric">
        <div class="label">Containers value</div>
        <div class="value">${{ containerValueTotal }}</div>
      </div>
    </div>

    <div class="toolbar">
      <input
        v-model="search"
        placeholder="Search SKU or name…"
        style="max-width: 240px"
        @keyup.enter="load"
      />
      <select v-model="itemType" style="max-width: 170px" @change="load">
        <option value="">All types</option>
        <option v-for="t in ITEM_TYPES" :key="t" :value="t">{{ ITEM_TYPE_LABELS[t] }}</option>
        <option value="CONTAINER">Container</option>
      </select>
      <select v-model="statusFilter" style="max-width: 150px">
        <option value="">All status</option>
        <option v-for="s in STOCK_STATUSES" :key="s" :value="s">{{ STATUS_LABELS[s] }}</option>
      </select>
      <button @click="load">Search</button>
      <span class="spacer" />
      <button
        v-if="auth.hasPermission(PERMISSIONS.QB_SYNC_RUN)"
        @click="syncQuickBooks"
      >
        Sync QuickBooks
      </button>
      <RouterLink
        v-if="auth.hasPermission(PERMISSIONS.INVENTORY_CREATE) && auth.hasPermission(PERMISSIONS.STOCK_ADJUST)"
        class="btn primary"
        :to="{ name: 'inventory-opening' }"
      >
        Add opening stock
      </RouterLink>
    </div>

    <div class="panel">
      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Name</th>
            <th>Type</th>
            <th>Handling</th>
            <th class="num">Traceable (lb)</th>
            <th class="num">WIP (lb)</th>
            <th class="num">Quarantine (lb)</th>
            <th class="num">Avg cost</th>
            <th class="num">Value</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in filteredItems" :key="item.id" :class="{ inactive: !item.active }">
            <td>{{ item.sku }}</td>
            <td>{{ item.name }}</td>
            <td>{{ ITEM_TYPE_LABELS[item.itemType] }}</td>
            <td>{{ item.unitOfMeasure === "KG" ? "KG" : "LB" }}</td>
            <td class="num">
              {{ invQty(item) }}
              <div v-if="item.unitOfMeasure === 'KG'" class="inactive" style="font-size: 0.75rem">
                = {{ kgEquivalent(invQty(item)) }} kg
              </div>
            </td>
            <td class="num" :class="{ inactive: Number(wipQty(item)) === 0 }">{{ wipQty(item) }}</td>
            <td class="num" :class="{ inactive: Number(quarantineQty(item)) === 0 }">{{ quarantineQty(item) }}</td>
            <td class="num">{{ inv[item.id]?.avgCost ?? "0" }}</td>
            <td class="num">${{ totalValue(item) }}</td>
            <td>
              <RouterLink
                v-if="auth.hasPermission(PERMISSIONS.INVENTORY_UPDATE)"
                :to="{ name: 'inventory-edit', params: { id: item.id } }"
              >
                Edit
              </RouterLink>
              <template v-if="canPackOff && Number(wipQty(item)) > 0">
                <input
                  v-model="packQty[item.id]"
                  inputmode="decimal"
                  placeholder="qty"
                  style="text-align: right; max-width: 64px; margin-left: 0.5rem"
                />
                <button style="margin-left: 0.3rem" @click="packOff(item)">Pack off</button>
              </template>
            </td>
          </tr>
          <tr
            v-for="c in filteredContainers"
            :key="c.id"
            :class="{ inactive: !c.active }"
          >
            <td>{{ c.sku }}</td>
            <td>{{ c.name }}</td>
            <td>Container</td>
            <td>each</td>
            <td class="num">
              {{ c.quantityOnHand }}
              <div class="inactive" style="font-size: 0.75rem">ea</div>
            </td>
            <td class="num inactive">—</td>
            <td class="num inactive">—</td>
            <td class="num">{{ c.avgCost }}</td>
            <td class="num">${{ c.totalValue }}</td>
            <td>
              <RouterLink
                v-if="auth.hasPermission(PERMISSIONS.INVENTORY_READ)"
                :to="{ name: 'container-detail', params: { id: c.id } }"
              >
                Open
              </RouterLink>
            </td>
          </tr>
          <tr v-if="!loading && filteredItems.length === 0 && filteredContainers.length === 0">
            <td colspan="10" class="inactive">No items.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
