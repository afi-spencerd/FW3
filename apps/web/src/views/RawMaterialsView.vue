<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { RouterLink } from "vue-router";
import {
  type InventoryItem,
  kgEquivalent,
  PERMISSIONS,
  type Prop65Status,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();

const PROP65_LABELS: Record<Prop65Status, string> = {
  UNKNOWN: "—",
  NOT_LISTED: "Not listed",
  LISTED: "Listed",
};

const items = ref<InventoryItem[]>([]);
// itemId -> INV quantity (canonical pounds), from the stock ledger.
const invQty = reactive<Record<string, string>>({});
const search = ref("");
const useFilter = ref<"" | "production" | "rnd">("");
const loading = ref(false);
const error = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [page, positions] = await Promise.all([
      api.listInventory({
        search: search.value || undefined,
        itemType: "RAW_MATERIAL",
        pageSize: 200,
      }),
      api.stockPositions(),
    ]);
    items.value = page.items;
    for (const key of Object.keys(invQty)) delete invQty[key];
    for (const p of positions) {
      if (p.status === "INV") invQty[p.itemId] = p.quantity;
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  } finally {
    loading.value = false;
  }
}

const filteredItems = computed(() =>
  items.value.filter((i) => {
    if (useFilter.value === "production") return i.productionUse;
    if (useFilter.value === "rnd") return !i.productionUse;
    return true;
  }),
);

function qty(item: InventoryItem): string {
  return invQty[item.id] ?? "0";
}

onMounted(load);
</script>

<template>
  <div class="container">
    <div v-if="error" class="banner error">{{ error }}</div>

    <div class="toolbar">
      <h2 style="margin: 0">Raw materials</h2>
      <span class="spacer" />
      <input
        v-model="search"
        placeholder="Search SKU or name…"
        style="max-width: 240px"
        @keyup.enter="load"
      />
      <select v-model="useFilter" style="max-width: 180px">
        <option value="">All</option>
        <option value="production">Production use</option>
        <option value="rnd">R&amp;D / lab only</option>
      </select>
      <button @click="load">Search</button>
    </div>

    <p class="inactive" style="font-size: 0.85rem">
      Raw materials and their regulatory profile, against what is on hand.
      R&amp;D / lab-only materials are flagged and excluded from the production
      compounder tool. Open a material to view or edit its full details.
    </p>

    <div class="panel">
      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Name</th>
            <th class="num">On hand (lb)</th>
            <th>CAS #</th>
            <th class="num">Flash pt (°C)</th>
            <th>Prop 65</th>
            <th class="num">IFRA limits</th>
            <th>Use</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in filteredItems"
            :key="item.id"
            :class="{ inactive: !item.active }"
          >
            <td>{{ item.sku }}</td>
            <td>{{ item.name }}</td>
            <td class="num">
              {{ qty(item) }}
              <div v-if="item.unitOfMeasure === 'KG'" class="inactive" style="font-size: 0.75rem">
                = {{ kgEquivalent(qty(item)) }} kg
              </div>
            </td>
            <td>{{ item.casNumber ?? "—" }}</td>
            <td class="num">{{ item.flashPointC ?? "—" }}</td>
            <td :class="{ warn: item.prop65Status === 'LISTED' }">
              {{ PROP65_LABELS[item.prop65Status] }}
            </td>
            <td class="num">{{ item.ifraLimits.length || "—" }}</td>
            <td>
              <span v-if="item.productionUse">Production</span>
              <span v-else class="badge-rnd">R&amp;D only</span>
            </td>
            <td>
              <RouterLink
                v-if="auth.hasPermission(PERMISSIONS.INVENTORY_READ)"
                :to="{ name: 'inventory-edit', params: { id: item.id } }"
              >
                Details
              </RouterLink>
            </td>
          </tr>
          <tr v-if="!loading && filteredItems.length === 0">
            <td colspan="9" class="inactive">No raw materials.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.warn {
  color: #b45309;
  font-weight: 600;
}
.badge-rnd {
  font-size: 0.75rem;
  background: #fde68a;
  color: #78350f;
  padding: 0.1rem 0.4rem;
  border-radius: 0.3rem;
}
</style>
