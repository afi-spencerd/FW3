<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  isFullyReceived,
  KG_TO_LB_FORMULA,
  LB_PER_KG,
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
  // A line within tolerance is effectively complete — don't show a fractional remainder.
  if (isFullyReceived(ordered, received)) return 0;
  return Number(ordered) - Number(received);
}

// Fill the receive field with the exact outstanding quantity (in the line's unit),
// so the receiver never hand-converts from a pound weight to hit the order exactly.
function fillRemaining(line: { id: string; quantityOrdered: string; quantityReceived: string }): void {
  const rem = Number(line.quantityOrdered) - Number(line.quantityReceived);
  receiveQty[line.id] = String(Math.round(rem * 10000) / 10000);
}

// KG lines are entered in kg; show what they'll store as (pounds).
function poundsPreview(kgQty: string): string {
  const lb = Number(kgQty) * Number(LB_PER_KG);
  if (!Number.isFinite(lb)) return "0";
  return String(Math.round(lb * 10000) / 10000);
}
const hasKgLine = computed(
  () => po.value?.lines.some((l) => l.handlingUnit === "KG") ?? false,
);

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
    notice.value = "Receipt posted — inventory and cost updated.";
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
            <td>
              {{ line.name }} <span class="inactive">({{ line.sku }})</span>
              <span v-if="line.lineType === 'CONTAINER'" class="inactive"> · container</span>
            </td>
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
              <div class="inactive" style="font-size: 0.75rem">
                <template v-if="line.handlingUnit === 'KG'">
                  kg → stores {{ poundsPreview(receiveQty[line.id] ?? '0') }} lb
                </template>
                <template v-else-if="line.lineType === 'CONTAINER'">each</template>
                <template v-else>lb</template>
              </div>
              <a
                v-if="remaining(line.quantityOrdered, line.quantityReceived) > 0"
                href="#"
                style="font-size: 0.75rem"
                @click.prevent="fillRemaining(line)"
              >
                Receive remaining
              </a>
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
        <span v-if="hasKgLine" class="inactive" style="font-size: 0.85rem; align-self: center">
          KG materials are converted to pounds on receipt: {{ KG_TO_LB_FORMULA }}
        </span>
        <span class="inactive" style="font-size: 0.85rem; align-self: center">
          Received goods go to quarantine pending QC.
        </span>
      </div>

      <h3 style="margin-top: 1.5rem">Receipts</h3>
      <p class="inactive" style="font-size: 0.85rem">
        Every posted receipt against this PO, including partials. Material
        receipts open a quarantine lot pending QC; container receipts go straight
        to container stock.
      </p>
      <table>
        <thead>
          <tr>
            <th>When</th><th>Subject</th><th class="num">Qty</th>
            <th class="num">Unit cost</th><th>Lot #</th><th>Location</th><th>QC</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in po.receipts" :key="r.id">
            <td>{{ new Date(r.receivedAt).toLocaleString() }}</td>
            <td>
              {{ r.name }} <span class="inactive">({{ r.sku }})</span>
              <span v-if="r.lineType === 'CONTAINER'" class="inactive"> · container</span>
            </td>
            <td class="num">{{ r.quantity }}</td>
            <td class="num">{{ r.unitCost }}</td>
            <td>{{ r.lotNumber ?? "—" }}</td>
            <td>{{ r.locationCode ?? "—" }}</td>
            <td>{{ r.qcStatus ?? "—" }}</td>
          </tr>
          <tr v-if="po.receipts.length === 0">
            <td colspan="7" class="inactive">No receipts posted yet.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
