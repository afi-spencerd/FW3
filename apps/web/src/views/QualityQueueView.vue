<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { QC_LOT_STATUSES, type LotSummary, type QcLotStatus } from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";

const lots = ref<LotSummary[]>([]);
const ORIGIN_LABELS: Record<string, string> = {
  RECEIPT: "Received",
  PRODUCTION: "Produced",
};
const statusFilter = ref<QcLotStatus | "">("PENDING");
const error = ref<string | null>(null);

async function load(): Promise<void> {
  error.value = null;
  try {
    lots.value = await api.listQualityLots(statusFilter.value || undefined);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

watch(statusFilter, load);
onMounted(load);
</script>

<template>
  <div class="container">
    <div v-if="error" class="banner error">{{ error }}</div>
    <div class="toolbar">
      <h2 style="margin: 0">Quality control — received lots</h2>
      <span class="spacer" />
      <select v-model="statusFilter" style="max-width: 160px">
        <option value="">All</option>
        <option v-for="s in QC_LOT_STATUSES" :key="s" :value="s">{{ s }}</option>
      </select>
    </div>
    <div class="panel">
      <table>
        <thead>
          <tr>
            <th>Lot #</th>
            <th>Origin</th>
            <th>Item</th>
            <th>Source</th>
            <th class="num">Qty</th>
            <th>QC status</th>
            <th class="num">Tests passed</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in lots" :key="l.id">
            <td>
              <RouterLink :to="{ name: 'quality-lot', params: { id: l.id } }">
                {{ l.lotNumber }}
              </RouterLink>
            </td>
            <td>{{ ORIGIN_LABELS[l.origin] ?? l.origin }}</td>
            <td>{{ l.itemName }} <span class="inactive">({{ l.itemSku }})</span></td>
            <td>{{ l.vendorName ?? l.workOrderNumber }}</td>
            <td class="num">{{ l.quantity }}</td>
            <td>{{ l.qcStatus }}</td>
            <td class="num">{{ l.passCount }} / {{ l.testCount }}</td>
            <td>{{ new Date(l.receivedAt).toLocaleDateString() }}</td>
          </tr>
          <tr v-if="lots.length === 0"><td colspan="8" class="inactive">No lots.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
