<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import type { ArDetail } from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";

const props = defineProps<{ customerId: string }>();
const router = useRouter();
const ar = ref<ArDetail | null>(null);
const error = ref<string | null>(null);

const BUCKET_LABELS: Record<string, string> = {
  current: "Current",
  d1_30: "1–30 days",
  d31_60: "31–60 days",
  d61_90: "61–90 days",
  d90_plus: "90+ days",
};

function money(v: string | null): string {
  return v === null ? "—" : `$${Number(v).toFixed(2)}`;
}

onMounted(async () => {
  try {
    ar.value = await api.customerAr(props.customerId);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  }
});
</script>

<template>
  <div class="container" style="max-width: 900px">
    <div v-if="error" class="banner error">{{ error }}</div>
    <div class="toolbar">
      <h2 style="margin: 0">{{ ar?.customerName ?? "Receivable" }}</h2>
      <span class="spacer" />
      <button @click="router.push({ name: 'accounts-receivable' })">Back</button>
    </div>

    <div v-if="ar" class="panel">
      <div class="grid-2">
        <div class="field">
          <label>Outstanding balance</label>
          <strong>{{ money(ar.currentExposure) }}</strong>
        </div>
        <div class="field">
          <label>Credit limit</label>
          <strong>{{ money(ar.creditLimit) }}</strong>
        </div>
        <div class="field">
          <label>Available credit</label>
          <strong :class="{ over: ar.availableCredit !== null && Number(ar.availableCredit) < 0 }">
            {{ money(ar.availableCredit) }}
          </strong>
        </div>
        <div class="field">
          <label>Payment terms</label>
          <strong>{{ ar.customerPaymentTerms?.replace(/_/g, " ") ?? "—" }}</strong>
        </div>
      </div>

      <h4>Aging</h4>
      <table>
        <thead>
          <tr>
            <th>Current</th>
            <th>1–30</th>
            <th>31–60</th>
            <th>61–90</th>
            <th>90+</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{{ money(ar.aging.current) }}</td>
            <td>{{ money(ar.aging.d1_30) }}</td>
            <td>{{ money(ar.aging.d31_60) }}</td>
            <td>{{ money(ar.aging.d61_90) }}</td>
            <td :class="{ over: Number(ar.aging.d90_plus) > 0 }">{{ money(ar.aging.d90_plus) }}</td>
          </tr>
        </tbody>
      </table>

      <h4 style="margin-top: 1rem">Open orders</h4>
      <table>
        <thead>
          <tr>
            <th>SO #</th>
            <th>Ordered</th>
            <th>Due</th>
            <th class="num">Balance</th>
            <th>Aging</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in ar.orders" :key="o.salesOrderId">
            <td>
              <RouterLink :to="{ name: 'sales-order-detail', params: { id: o.salesOrderId } }">
                {{ o.soNumber }}
              </RouterLink>
            </td>
            <td>{{ new Date(o.orderDate).toLocaleDateString() }}</td>
            <td>{{ new Date(o.dueDate).toLocaleDateString() }}</td>
            <td class="num">{{ money(o.balanceDue) }}</td>
            <td :class="{ over: o.daysPastDue > 0 }">
              {{ o.daysPastDue > 0 ? `${BUCKET_LABELS[o.bucket]} (${o.daysPastDue}d past due)` : "Current" }}
            </td>
          </tr>
          <tr v-if="ar.orders.length === 0">
            <td colspan="5" class="inactive">No open orders.</td>
          </tr>
        </tbody>
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
