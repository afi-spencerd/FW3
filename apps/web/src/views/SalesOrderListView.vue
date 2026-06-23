<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { PERMISSIONS, type SalesOrderSummary } from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const orders = ref<SalesOrderSummary[]>([]);
const error = ref<string | null>(null);

async function load(): Promise<void> {
  error.value = null;
  try {
    orders.value = await api.listSalesOrders();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

onMounted(load);
</script>

<template>
  <div class="container">
    <div v-if="error" class="banner error">{{ error }}</div>
    <div class="toolbar">
      <h2 style="margin: 0">Sales orders</h2>
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
            <th>SO #</th>
            <th>Customer</th>
            <th>Status</th>
            <th class="num">Lines</th>
            <th class="num">Revenue</th>
            <th>Ordered</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in orders" :key="o.id">
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
          <tr v-if="orders.length === 0"><td colspan="6" class="inactive">No sales orders yet.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
