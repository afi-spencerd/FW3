<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { StockPosition } from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";

const positions = ref<StockPosition[]>([]);
const error = ref<string | null>(null);

const STATE_LABELS: Record<string, string> = { INV: "Traceable", WIP: "WIP" };

function sumValue(rows: StockPosition[]): string {
  return rows
    .reduce((total, r) => total + Number(r.totalValue), 0)
    .toFixed(2);
}

const traceableValue = computed(() =>
  sumValue(positions.value.filter((p) => p.state === "INV")),
);
const wipValue = computed(() =>
  sumValue(positions.value.filter((p) => p.state === "WIP")),
);

async function load(): Promise<void> {
  error.value = null;
  try {
    positions.value = await api.stockPositions();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

onMounted(load);
</script>

<template>
  <div class="container">
    <div v-if="error" class="banner error">{{ error }}</div>

    <div class="panel summary" style="margin-bottom: 1rem">
      <div class="metric">
        <div class="label">LOT-traceable value (INV)</div>
        <div class="value">${{ traceableValue }}</div>
      </div>
      <div class="metric">
        <div class="label">WIP value</div>
        <div class="value">${{ wipValue }}</div>
      </div>
    </div>

    <div class="panel">
      <h3 style="margin-top: 0">Stock positions by state</h3>
      <p class="inactive" style="font-size: 0.85rem">
        WIP = raw materials in refill cans and finished goods in the vat before
        pack-off. Traceable (INV) = received and packed stock.
      </p>
      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Name</th>
            <th>Type</th>
            <th>State</th>
            <th class="num">Qty</th>
            <th class="num">Avg cost</th>
            <th class="num">Value</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in positions" :key="p.itemId + p.state">
            <td>{{ p.sku }}</td>
            <td>{{ p.name }}</td>
            <td>{{ p.itemType }}</td>
            <td>{{ STATE_LABELS[p.state] ?? p.state }}</td>
            <td class="num">{{ p.quantity }}</td>
            <td class="num">{{ p.avgCost }}</td>
            <td class="num">${{ p.totalValue }}</td>
          </tr>
          <tr v-if="positions.length === 0">
            <td colspan="7" class="inactive">No stock positions.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
