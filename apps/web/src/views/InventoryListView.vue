<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { RouterLink } from "vue-router";
import {
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
const valuation = ref<ValuationSummary | null>(null);
// itemId -> position, per non-traceable status
const wip = reactive<Record<string, { quantity: string; value: string }>>({});
const quarantine = reactive<Record<string, { quantity: string; value: string }>>({});
const wipTotal = ref("0");
const quarantineTotal = ref("0");

const search = ref("");
const itemType = ref<ItemType | "">("");
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
function totalValue(item: InventoryItem): string {
  return (
    Number(item.extendedValue) +
    Number(wip[item.id]?.value ?? "0") +
    Number(quarantine[item.id]?.value ?? "0")
  ).toFixed(2);
}

const filteredItems = computed(() =>
  items.value.filter((i) => {
    if (statusFilter.value === "WIP") return Number(wipQty(i)) > 0;
    if (statusFilter.value === "QUARANTINE") return Number(quarantineQty(i)) > 0;
    if (statusFilter.value === "INV") return Number(i.quantityOnHand) > 0;
    return true;
  }),
);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [page, positions, val] = await Promise.all([
      api.listInventory({
        search: search.value || undefined,
        itemType: itemType.value || undefined,
        pageSize: 200,
      }),
      api.stockPositions(),
      api.valuation(),
    ]);
    items.value = page.items;
    valuation.value = val;
    for (const key of Object.keys(wip)) delete wip[key];
    for (const key of Object.keys(quarantine)) delete quarantine[key];
    let wipSum = 0;
    let quarantineSum = 0;
    for (const p of positions) {
      if (p.status === "WIP") {
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

async function remove(item: InventoryItem): Promise<void> {
  if (!confirm(`Delete ${item.sku}?`)) return;
  try {
    await api.deleteInventory(item.id);
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Delete failed";
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
    notice.value = `Packed off ${qty} ${item.sku} — moved from WIP to traceable stock.`;
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
        v-if="auth.hasPermission(PERMISSIONS.INVENTORY_CREATE)"
        class="btn primary"
        :to="{ name: 'inventory-new' }"
      >
        New item
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
              {{ item.quantityOnHand }}
              <div v-if="item.unitOfMeasure === 'KG'" class="inactive" style="font-size: 0.75rem">
                = {{ kgEquivalent(item.quantityOnHand) }} kg
              </div>
            </td>
            <td class="num" :class="{ inactive: Number(wipQty(item)) === 0 }">{{ wipQty(item) }}</td>
            <td class="num" :class="{ inactive: Number(quarantineQty(item)) === 0 }">{{ quarantineQty(item) }}</td>
            <td class="num">{{ item.unitCost }}</td>
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
              <button
                v-if="auth.hasPermission(PERMISSIONS.INVENTORY_DELETE)"
                class="danger"
                style="margin-left: 0.5rem"
                @click="remove(item)"
              >
                Delete
              </button>
            </td>
          </tr>
          <tr v-if="!loading && filteredItems.length === 0">
            <td colspan="10" class="inactive">No items.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
