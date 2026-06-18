<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { PERMISSIONS, type SalesOrder } from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const props = defineProps<{ id: string }>();
const router = useRouter();
const auth = useAuthStore();

const so = ref<SalesOrder | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = ref(false);
const shipQty = reactive<Record<string, string>>({});

const canShip = computed(
  () =>
    so.value !== null &&
    (so.value.status === "OPEN" || so.value.status === "PARTIAL") &&
    auth.hasPermission(PERMISSIONS.SO_SHIP),
);
const canCancel = computed(
  () =>
    so.value !== null &&
    so.value.status !== "CANCELLED" &&
    so.value.status !== "SHIPPED" &&
    so.value.lines.every((l) => Number(l.quantityShipped) === 0) &&
    auth.hasPermission(PERMISSIONS.SO_UPDATE),
);

function remaining(ordered: string, shipped: string): number {
  return Number(ordered) - Number(shipped);
}

async function load(): Promise<void> {
  error.value = null;
  try {
    so.value = await api.getSalesOrder(props.id);
    for (const line of so.value.lines) shipQty[line.id] = "0";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

async function ship(): Promise<void> {
  if (!so.value) return;
  notice.value = null;
  error.value = null;
  const lines = Object.entries(shipQty)
    .filter(([, q]) => Number(q) > 0)
    .map(([salesOrderLineId, quantity]) => ({ salesOrderLineId, quantity }));
  if (lines.length === 0) {
    error.value = "Enter a quantity to ship on at least one line.";
    return;
  }
  busy.value = true;
  try {
    so.value = await api.shipSalesOrder(props.id, { lines });
    for (const line of so.value.lines) shipQty[line.id] = "0";
    notice.value = "Shipment posted — inventory reduced at cost (COGS).";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Shipment failed";
  } finally {
    busy.value = false;
  }
}

async function cancel(): Promise<void> {
  if (!confirm("Cancel this sales order?")) return;
  try {
    so.value = await api.cancelSalesOrder(props.id);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Cancel failed";
  }
}

onMounted(load);
</script>

<template>
  <div class="container" style="max-width: 860px">
    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="notice" class="banner ok">{{ notice }}</div>

    <div v-if="so" class="panel">
      <div class="toolbar">
        <h2 style="margin: 0">{{ so.soNumber }}</h2>
        <span class="spacer" />
        <button @click="router.push({ name: 'sales-orders' })">Back</button>
        <button v-if="canCancel" class="danger" @click="cancel">Cancel SO</button>
      </div>
      <div class="summary" style="margin-bottom: 1rem">
        <div class="metric"><div class="label">Customer</div><div class="value" style="font-size: 1rem">{{ so.customerName }}</div></div>
        <div class="metric"><div class="label">Status</div><div class="value" style="font-size: 1rem">{{ so.status }}</div></div>
        <div class="metric"><div class="label">Revenue</div><div class="value">${{ so.totalRevenue }}</div></div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th class="num">Ordered</th>
            <th class="num">Shipped</th>
            <th class="num">Remaining</th>
            <th class="num">Unit price</th>
            <th v-if="canShip" class="num">Ship now</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="line in so.lines" :key="line.id">
            <td>{{ line.itemName }} <span class="inactive">({{ line.itemSku }})</span></td>
            <td class="num">{{ line.quantityOrdered }}</td>
            <td class="num">{{ line.quantityShipped }}</td>
            <td class="num">{{ remaining(line.quantityOrdered, line.quantityShipped) }}</td>
            <td class="num">{{ line.unitPrice }}</td>
            <td v-if="canShip" class="num">
              <input
                v-model="shipQty[line.id]"
                inputmode="decimal"
                style="text-align: right; max-width: 90px"
                :disabled="remaining(line.quantityOrdered, line.quantityShipped) <= 0"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="canShip" class="toolbar">
        <button class="primary" :disabled="busy" @click="ship">
          {{ busy ? "Posting…" : "Post shipment" }}
        </button>
      </div>
    </div>
  </div>
</template>
