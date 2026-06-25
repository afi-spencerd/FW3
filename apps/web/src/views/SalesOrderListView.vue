<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { PERMISSIONS, SO_STATUSES, type SalesOrderSummary } from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const orders = ref<SalesOrderSummary[]>([]);
const error = ref<string | null>(null);

const search = ref("");
const statusFilter = ref("");
const customerFilter = ref("");

// Sortable columns and how each maps to a comparable value.
type SortKey = "soNumber" | "customerName" | "status" | "lineCount" | "totalRevenue" | "orderDate";
const sortKey = ref<SortKey>("orderDate");
const sortDir = ref<"asc" | "desc">("desc"); // default: newest orders first

async function load(): Promise<void> {
  error.value = null;
  try {
    orders.value = await api.listSalesOrders();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

// Customers present in the loaded orders (for the filter dropdown), name-sorted.
const customers = computed(() => {
  const byId = new Map<string, string>();
  for (const o of orders.value) byId.set(o.customerId, o.customerName);
  return [...byId.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
});

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return orders.value.filter((o) => {
    if (statusFilter.value && o.status !== statusFilter.value) return false;
    if (customerFilter.value && o.customerId !== customerFilter.value) return false;
    if (!q) return true;
    return (
      o.soNumber.toLowerCase().includes(q) ||
      o.customerName.toLowerCase().includes(q) ||
      (o.customerPoNumber ?? "").toLowerCase().includes(q)
    );
  });
});

function compare(a: SalesOrderSummary, b: SalesOrderSummary): number {
  switch (sortKey.value) {
    case "lineCount":
      return a.lineCount - b.lineCount;
    case "totalRevenue":
      return Number(a.totalRevenue) - Number(b.totalRevenue);
    case "orderDate":
      return Date.parse(a.orderDate) - Date.parse(b.orderDate);
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
      <h2 style="margin: 0">Sales orders</h2>
      <input
        v-model="search"
        placeholder="Search SO #, customer, PO…"
        style="max-width: 240px"
      />
      <select v-model="statusFilter" style="max-width: 160px">
        <option value="">All statuses</option>
        <option v-for="s in SO_STATUSES" :key="s" :value="s">{{ s }}</option>
      </select>
      <select v-model="customerFilter" style="max-width: 200px">
        <option value="">All customers</option>
        <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <span class="spacer" />
      <RouterLink
        v-if="auth.hasPermission(PERMISSIONS.SO_CREATE)"
        class="btn"
        :to="{ name: 'sales-order-import' }"
      >
        Import CSV
      </RouterLink>
      <RouterLink
        v-if="auth.hasPermission(PERMISSIONS.SO_CREATE)"
        class="btn primary"
        :to="{ name: 'sales-order-new' }"
      >
        New SO
      </RouterLink>
    </div>
    <div class="panel">
      <table>
        <thead>
          <tr>
            <th class="sortable" @click="sortBy('soNumber')">SO #{{ sortIndicator("soNumber") }}</th>
            <th class="sortable" @click="sortBy('customerName')">Customer{{ sortIndicator("customerName") }}</th>
            <th class="sortable" @click="sortBy('status')">Status{{ sortIndicator("status") }}</th>
            <th class="num sortable" @click="sortBy('lineCount')">Lines{{ sortIndicator("lineCount") }}</th>
            <th class="num sortable" @click="sortBy('totalRevenue')">Revenue{{ sortIndicator("totalRevenue") }}</th>
            <th class="sortable" @click="sortBy('orderDate')">Ordered{{ sortIndicator("orderDate") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in sorted" :key="o.id">
            <td>
              <RouterLink :to="{ name: 'sales-order-detail', params: { id: o.id } }">
                {{ o.soNumber }}
              </RouterLink>
            </td>
            <td>{{ o.customerName }}</td>
            <td>{{ o.status }}</td>
            <td class="num">{{ o.lineCount }}</td>
            <td class="num">${{ o.totalRevenue }}</td>
            <td>{{ new Date(o.orderDate).toLocaleDateString() }}</td>
          </tr>
          <tr v-if="sorted.length === 0">
            <td colspan="6" class="inactive">
              {{ orders.length === 0 ? "No sales orders yet." : "No matching sales orders." }}
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
