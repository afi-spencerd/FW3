<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  type Location,
  PERMISSIONS,
  type PurchaseOrder,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const props = defineProps<{ id: string }>();
const router = useRouter();
const auth = useAuthStore();

const po = ref<PurchaseOrder | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = ref(false);
// lineId -> quantity / supplier lot to receive now
const receiveQty = reactive<Record<string, string>>({});
const lotNumber = reactive<Record<string, string>>({});
// Receiving docks to choose which building the goods land in.
const receivingLocations = ref<Location[]>([]);
const receivingLocationId = ref<string>("");

const canReceive = computed(
  () =>
    po.value !== null &&
    (po.value.status === "OPEN" || po.value.status === "PARTIAL") &&
    auth.hasPermission(PERMISSIONS.PO_RECEIVE),
);
const canCancel = computed(
  () =>
    po.value !== null &&
    po.value.status !== "CANCELLED" &&
    po.value.status !== "RECEIVED" &&
    po.value.lines.every((l) => Number(l.quantityReceived) === 0) &&
    auth.hasPermission(PERMISSIONS.PO_UPDATE),
);

function remaining(ordered: string, received: string): number {
  return Number(ordered) - Number(received);
}

async function load(): Promise<void> {
  error.value = null;
  try {
    po.value = await api.getPurchaseOrder(props.id);
    for (const line of po.value.lines) receiveQty[line.id] = "0";
    const locs = await api.listLocations();
    receivingLocations.value = locs.filter((l) => l.isReceiving && l.active);
    if (!receivingLocationId.value && receivingLocations.value.length) {
      receivingLocationId.value = receivingLocations.value[0]!.id;
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

async function receive(): Promise<void> {
  if (!po.value) return;
  notice.value = null;
  error.value = null;
  const lines = Object.entries(receiveQty)
    .filter(([, q]) => Number(q) > 0)
    .map(([purchaseOrderLineId, quantity]) => ({
      purchaseOrderLineId,
      quantity,
      supplierLotNumber: lotNumber[purchaseOrderLineId]?.trim() || undefined,
    }));
  if (lines.length === 0) {
    error.value = "Enter a quantity to receive on at least one line.";
    return;
  }
  busy.value = true;
  try {
    po.value = await api.receivePurchaseOrder(props.id, {
      lines,
      ...(receivingLocationId.value ? { locationId: receivingLocationId.value } : {}),
    });
    for (const line of po.value.lines) receiveQty[line.id] = "0";
    notice.value = "Receipt posted — stock and cost updated.";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Receive failed";
  } finally {
    busy.value = false;
  }
}

async function cancel(): Promise<void> {
  if (!confirm("Cancel this purchase order?")) return;
  try {
    po.value = await api.cancelPurchaseOrder(props.id);
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

    <div v-if="po" class="panel">
      <div class="toolbar">
        <h2 style="margin: 0">{{ po.poNumber }}</h2>
        <span class="spacer" />
        <button @click="router.push({ name: 'purchase-orders' })">Back</button>
        <button v-if="canCancel" class="danger" @click="cancel">Cancel PO</button>
      </div>
      <div class="summary" style="margin-bottom: 1rem">
        <div class="metric"><div class="label">Vendor</div><div class="value" style="font-size: 1rem">{{ po.vendorName }}</div></div>
        <div class="metric"><div class="label">Status</div><div class="value" style="font-size: 1rem">{{ po.status }}</div></div>
        <div class="metric"><div class="label">Total</div><div class="value">${{ po.totalValue }}</div></div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th class="num">Ordered</th>
            <th class="num">Received</th>
            <th class="num">Remaining</th>
            <th class="num">Unit cost</th>
            <th v-if="canReceive" class="num">Receive now</th>
            <th v-if="canReceive">Supplier lot #</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="line in po.lines" :key="line.id">
            <td>{{ line.itemName }} <span class="inactive">({{ line.itemSku }})</span></td>
            <td class="num">{{ line.quantityOrdered }}</td>
            <td class="num">{{ line.quantityReceived }}</td>
            <td class="num">{{ remaining(line.quantityOrdered, line.quantityReceived) }}</td>
            <td class="num">{{ line.unitCost }}</td>
            <td v-if="canReceive" class="num">
              <input
                v-model="receiveQty[line.id]"
                inputmode="decimal"
                style="text-align: right; max-width: 90px"
                :disabled="remaining(line.quantityOrdered, line.quantityReceived) <= 0"
              />
            </td>
            <td v-if="canReceive">
              <input
                v-model="lotNumber[line.id]"
                placeholder="auto"
                style="max-width: 140px"
                :disabled="remaining(line.quantityOrdered, line.quantityReceived) <= 0"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="canReceive" class="toolbar" style="align-items: center">
        <label v-if="receivingLocations.length" style="display: inline-flex; align-items: center; gap: 0.4rem">
          Receive into
          <select v-model="receivingLocationId" style="max-width: 240px">
            <option v-for="l in receivingLocations" :key="l.id" :value="l.id">
              {{ l.code }} — {{ l.name }}
            </option>
          </select>
        </label>
        <button class="primary" :disabled="busy" @click="receive">
          {{ busy ? "Posting…" : "Post receipt" }}
        </button>
        <span class="inactive" style="font-size: 0.85rem; align-self: center">
          Received goods go to quarantine pending QC.
        </span>
      </div>
    </div>
  </div>
</template>
