<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import type { ProductionWorkOrderSummary } from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";

const all = ref<ProductionWorkOrderSummary[]>([]);
const error = ref<string | null>(null);

async function load(): Promise<void> {
  error.value = null;
  try {
    all.value = await api.listProductionWorkOrders();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

// Upcoming run order: QUEUED, by queue position.
const queued = computed(() =>
  all.value
    .filter((w) => w.status === "QUEUED")
    .sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0)),
);
// Released and ready for the floor to stage.
const released = computed(() =>
  all.value.filter((w) => w.status === "PLANNED"),
);

onMounted(load);
</script>

<template>
  <div class="container">
    <div v-if="error" class="banner error">{{ error }}</div>
    <div class="toolbar">
      <h2 style="margin: 0">Production run queue</h2>
    </div>

    <div class="panel">
      <h3>Released — ready to stage ({{ released.length }})</h3>
      <table>
        <thead>
          <tr>
            <th>WO #</th>
            <th>Target</th>
            <th>SO</th>
            <th class="num">Batch</th>
            <th class="num">Output</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in released" :key="r.id">
            <td>
              <RouterLink :to="{ name: 'production-detail', params: { id: r.id } }">
                {{ r.workOrderNumber }}
              </RouterLink>
            </td>
            <td>{{ r.targetName }} <span class="inactive">({{ r.targetSku }})</span></td>
            <td>{{ r.soNumber ?? "—" }}</td>
            <td class="num">{{ r.batchSize }} {{ r.batchUnit }}</td>
            <td class="num">{{ r.outputQty }}</td>
          </tr>
          <tr v-if="released.length === 0">
            <td colspan="5" class="inactive">Nothing released yet.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="panel">
      <h3>Upcoming queue ({{ queued.length }})</h3>
      <p class="inactive" style="font-size: 0.8rem">
        The scheduler's planned run order. These aren't released yet.
      </p>
      <table>
        <thead>
          <tr>
            <th class="num">#</th>
            <th>WO #</th>
            <th>Target</th>
            <th>SO</th>
            <th class="num">Batch</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in queued" :key="r.id">
            <td class="num">{{ (r.queuePosition ?? 0) + 1 }}</td>
            <td>
              <RouterLink :to="{ name: 'production-detail', params: { id: r.id } }">
                {{ r.workOrderNumber }}
              </RouterLink>
            </td>
            <td>{{ r.targetName }} <span class="inactive">({{ r.targetSku }})</span></td>
            <td>{{ r.soNumber ?? "—" }}</td>
            <td class="num">{{ r.batchSize }} {{ r.batchUnit }}</td>
          </tr>
          <tr v-if="queued.length === 0">
            <td colspan="5" class="inactive">Queue is empty.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
