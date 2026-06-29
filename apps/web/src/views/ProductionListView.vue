<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { PERMISSIONS, PRODUCTION_STATUSES, type ProductionWorkOrderSummary } from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const runs = ref<ProductionWorkOrderSummary[]>([]);
const error = ref<string | null>(null);

const search = ref("");
const statusFilter = ref("");

// Sortable columns and how each maps to a comparable value.
type SortKey = "workOrderNumber" | "targetName" | "status" | "batchSize" | "outputQty" | "lineCount";
const sortKey = ref<SortKey>("workOrderNumber");
const sortDir = ref<"asc" | "desc">("desc"); // newest WO numbers first ≈ load order

async function load(): Promise<void> {
  error.value = null;
  try {
    runs.value = await api.listProductionWorkOrders();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return runs.value.filter((r) => {
    if (statusFilter.value && r.status !== statusFilter.value) return false;
    if (!q) return true;
    return (
      r.workOrderNumber.toLowerCase().includes(q) ||
      r.targetName.toLowerCase().includes(q) ||
      r.targetSku.toLowerCase().includes(q)
    );
  });
});

function compare(a: ProductionWorkOrderSummary, b: ProductionWorkOrderSummary): number {
  switch (sortKey.value) {
    case "batchSize":
      return Number(a.batchSize) - Number(b.batchSize);
    case "outputQty":
      return Number(a.outputQty) - Number(b.outputQty);
    case "lineCount":
      return a.lineCount - b.lineCount;
    default:
      return String(a[sortKey.value]).localeCompare(String(b[sortKey.value]));
  }
}

const sorted = computed(() => {
  const dir = sortDir.value === "asc" ? 1 : -1;
  return [...filtered.value].sort((a, b) => compare(a, b) * dir);
});

function sortBy(key: SortKey): void {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  } else {
    sortKey.value = key;
    sortDir.value = "asc";
  }
}

function sortIndicator(key: SortKey): string {
  if (sortKey.value !== key) return "";
  return sortDir.value === "asc" ? " ▲" : " ▼";
}

onMounted(load);
</script>

<template>
  <div class="container">
    <div v-if="error" class="banner error">{{ error }}</div>
    <div class="toolbar">
      <h2 style="margin: 0">Production work orders</h2>
      <input
        v-model="search"
        placeholder="Search WO #, target, SKU…"
        style="max-width: 240px"
      />
      <select v-model="statusFilter" style="max-width: 160px">
        <option value="">All statuses</option>
        <option v-for="s in PRODUCTION_STATUSES" :key="s" :value="s">{{ s }}</option>
      </select>
      <span class="spacer" />
      <RouterLink
        v-if="auth.hasPermission(PERMISSIONS.PRODUCTION_CREATE)"
        class="btn primary"
        :to="{ name: 'production-new' }"
      >
        New work order
      </RouterLink>
    </div>
    <div class="panel">
      <table>
        <thead>
          <tr>
            <th class="sortable" @click="sortBy('workOrderNumber')">WO #{{ sortIndicator("workOrderNumber") }}</th>
            <th class="sortable" @click="sortBy('targetName')">Target{{ sortIndicator("targetName") }}</th>
            <th class="sortable" @click="sortBy('status')">Status{{ sortIndicator("status") }}</th>
            <th class="num sortable" @click="sortBy('batchSize')">Batch{{ sortIndicator("batchSize") }}</th>
            <th class="num sortable" @click="sortBy('outputQty')">Output{{ sortIndicator("outputQty") }}</th>
            <th class="num sortable" @click="sortBy('lineCount')">Components{{ sortIndicator("lineCount") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in sorted" :key="r.id">
            <td>
              <RouterLink :to="{ name: 'production-detail', params: { id: r.id } }">
                {{ r.workOrderNumber }}
              </RouterLink>
            </td>
            <td>{{ r.targetName }} <span class="inactive">({{ r.targetSku }})</span></td>
            <td>{{ r.status }}</td>
            <td class="num">{{ r.batchSize }} {{ r.batchUnit }}</td>
            <td class="num">{{ r.outputQty }}</td>
            <td class="num">{{ r.lineCount }}</td>
          </tr>
          <tr v-if="sorted.length === 0">
            <td colspan="6" class="inactive">
              {{ runs.length === 0 ? "No production work orders yet." : "No matching work orders." }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
th.sortable {
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
th.sortable:hover {
  color: var(--text);
}
</style>
