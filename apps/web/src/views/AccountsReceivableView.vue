<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import type { ArSummaryRow } from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";

const rows = ref<ArSummaryRow[]>([]);
const error = ref<string | null>(null);

function money(v: string | null): string {
  return v === null ? "—" : `$${Number(v).toFixed(2)}`;
}

async function load(): Promise<void> {
  error.value = null;
  try {
    rows.value = await api.listAr();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

// Totals across all customers, for the footer.
const totals = computed(() => {
  const sum = (pick: (r: ArSummaryRow) => string) =>
    rows.value.reduce((s, r) => s + Number(pick(r)), 0);
  return {
    exposure: sum((r) => r.currentExposure),
    current: sum((r) => r.aging.current),
    d1_30: sum((r) => r.aging.d1_30),
    d31_60: sum((r) => r.aging.d31_60),
    d61_90: sum((r) => r.aging.d61_90),
    d90_plus: sum((r) => r.aging.d90_plus),
  };
});

onMounted(load);
</script>

<template>
  <div class="container">
    <div v-if="error" class="banner error">{{ error }}</div>
    <div class="toolbar">
      <h2 style="margin: 0">Accounts receivable</h2>
    </div>
    <div class="panel">
      <table>
        <thead>
          <tr>
            <th>Customer</th>
            <th class="num">Outstanding</th>
            <th class="num">Credit limit</th>
            <th class="num">Available</th>
            <th class="num">Current</th>
            <th class="num">1–30</th>
            <th class="num">31–60</th>
            <th class="num">61–90</th>
            <th class="num">90+</th>
            <th class="num">Oldest</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.customerId">
            <td>
              <RouterLink :to="{ name: 'accounts-receivable-detail', params: { customerId: r.customerId } }">
                {{ r.customerName }}
              </RouterLink>
            </td>
            <td class="num">{{ money(r.currentExposure) }}</td>
            <td class="num">{{ money(r.creditLimit) }}</td>
            <td
              class="num"
              :class="{ over: r.availableCredit !== null && Number(r.availableCredit) < 0 }"
            >
              {{ money(r.availableCredit) }}
            </td>
            <td class="num">{{ money(r.aging.current) }}</td>
            <td class="num">{{ money(r.aging.d1_30) }}</td>
            <td class="num">{{ money(r.aging.d31_60) }}</td>
            <td class="num">{{ money(r.aging.d61_90) }}</td>
            <td class="num" :class="{ over: Number(r.aging.d90_plus) > 0 }">
              {{ money(r.aging.d90_plus) }}
            </td>
            <td class="num">{{ r.oldestPastDueDays > 0 ? `${r.oldestPastDueDays}d` : "—" }}</td>
          </tr>
          <tr v-if="rows.length === 0">
            <td colspan="10" class="inactive">No outstanding balances.</td>
          </tr>
        </tbody>
        <tfoot v-if="rows.length">
          <tr>
            <td><strong>Total</strong></td>
            <td class="num"><strong>${{ totals.exposure.toFixed(2) }}</strong></td>
            <td></td>
            <td></td>
            <td class="num">${{ totals.current.toFixed(2) }}</td>
            <td class="num">${{ totals.d1_30.toFixed(2) }}</td>
            <td class="num">${{ totals.d31_60.toFixed(2) }}</td>
            <td class="num">${{ totals.d61_90.toFixed(2) }}</td>
            <td class="num">${{ totals.d90_plus.toFixed(2) }}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>

<style scoped>
.over {
  color: #b91c1c;
  font-weight: 600;
}
</style>
