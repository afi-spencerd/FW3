<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { PERMISSIONS, type ProductionWorkOrderSummary } from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const runs = ref<ProductionWorkOrderSummary[]>([]);
const error = ref<string | null>(null);

async function load(): Promise<void> {
  error.value = null;
  try {
    runs.value = await api.listProductionWorkOrders();
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
      <h2 style="margin: 0">Production work orders</h2>
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
            <th>WO #</th>
            <th>Target</th>
            <th>Status</th>
            <th class="num">Batch</th>
            <th class="num">Output</th>
            <th class="num">Components</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in runs" :key="r.id">
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
          <tr v-if="runs.length === 0"><td colspan="6" class="inactive">No production work orders yet.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
