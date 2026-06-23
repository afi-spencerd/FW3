<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { NET_PAYMENT_TERMS, PERMISSIONS, type SalesOrder } from "@fw3/shared-types";
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
// Carrier / tracking / notes for the despatch being entered.
const shipMeta = reactive({ carrier: "", trackingNumber: "", notes: "" });
// Editable tracking per existing shipment (shipmentId -> fields).
const trackEdits = reactive<
  Record<string, { carrier: string; trackingNumber: string; notes: string }>
>({});
const trackBusy = ref<string | null>(null);
// Editable requested ship date (yyyy-mm-dd), seeded from the order.
const shipDateEdit = ref("");
const shipDateBusy = ref(false);

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
// Packing consumes the containers on the lines; only once, and only if some
// line specifies a container.
const hasContainers = computed(
  () => so.value?.lines.some((l) => l.containerId) ?? false,
);
const canPack = computed(
  () =>
    so.value !== null &&
    so.value.status !== "CANCELLED" &&
    !so.value.packedAt &&
    hasContainers.value &&
    auth.hasPermission(PERMISSIONS.SO_SHIP),
);
const packBusy = ref(false);
const prodBusy = ref(false);

const canMarkPaid = computed(
  () =>
    so.value !== null &&
    so.value.status !== "CANCELLED" &&
    !so.value.paidAt &&
    auth.hasPermission(PERMISSIONS.SO_UPDATE),
);
const canRequestProduction = computed(
  () =>
    so.value !== null &&
    so.value.status !== "CANCELLED" &&
    auth.hasPermission(PERMISSIONS.SO_REQUEST_PRODUCTION),
);
// Production can only be requested once the order is paid, or the customer is on
// net terms (they receive goods before paying).
const isRequestable = computed(
  () =>
    so.value !== null &&
    (so.value.paidAt !== null ||
      (so.value.customerPaymentTerms !== null &&
        (NET_PAYMENT_TERMS as readonly string[]).includes(
          so.value.customerPaymentTerms,
        ))),
);
const canEditShipDate = computed(
  () =>
    so.value !== null &&
    so.value.status === "OPEN" &&
    auth.hasPermission(PERMISSIONS.SO_UPDATE),
);

async function saveShipDate(): Promise<void> {
  if (!so.value || !shipDateEdit.value) return;
  error.value = null;
  notice.value = null;
  shipDateBusy.value = true;
  try {
    so.value = await api.updateSalesOrder(so.value.id, {
      requestedShipDate: new Date(shipDateEdit.value).toISOString(),
    });
    notice.value = "Ship date updated.";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to update ship date";
  } finally {
    shipDateBusy.value = false;
  }
}

async function markPaid(): Promise<void> {
  if (!so.value) return;
  error.value = null;
  notice.value = null;
  prodBusy.value = true;
  try {
    so.value = await api.markSalesOrderPaid(so.value.id);
    notice.value = "Payment recorded.";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed";
  } finally {
    prodBusy.value = false;
  }
}

async function requestProduction(): Promise<void> {
  if (!so.value) return;
  error.value = null;
  notice.value = null;
  prodBusy.value = true;
  try {
    so.value = await api.requestProduction(so.value.id);
    notice.value = "Production requested — work orders created for the scheduler.";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to request production";
  } finally {
    prodBusy.value = false;
  }
}

async function pack(): Promise<void> {
  if (!so.value) return;
  if (!confirm("Pack this order? This consumes the selected containers from inventory and can't be undone.")) {
    return;
  }
  error.value = null;
  notice.value = null;
  packBusy.value = true;
  try {
    so.value = await api.packSalesOrder(so.value.id);
    notice.value = "Order packed — containers deducted from inventory.";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Pack failed";
  } finally {
    packBusy.value = false;
  }
}

function remaining(ordered: string, shipped: string): number {
  return Number(ordered) - Number(shipped);
}

// The production work order backing a line (prefer an unfinished one), if any.
function lineWorkOrder(lineId: string) {
  const wos = so.value?.workOrders.filter((w) => w.salesOrderLineId === lineId) ?? [];
  if (wos.length === 0) return null;
  return (
    wos.find((w) => w.status !== "COMPLETED" && w.status !== "CANCELLED") ?? wos[0]
  );
}
function productionPending(lineId: string): boolean {
  const wo = lineWorkOrder(lineId);
  return !!wo && wo.status !== "COMPLETED" && wo.status !== "CANCELLED";
}

function syncTrackEdits(order: SalesOrder): void {
  for (const key of Object.keys(trackEdits)) delete trackEdits[key];
  for (const s of order.shipments) {
    trackEdits[s.id] = {
      carrier: s.carrier ?? "",
      trackingNumber: s.trackingNumber ?? "",
      notes: s.notes ?? "",
    };
  }
}

async function load(): Promise<void> {
  error.value = null;
  try {
    so.value = await api.getSalesOrder(props.id);
    for (const line of so.value.lines) shipQty[line.id] = "0";
    shipDateEdit.value = so.value.requestedShipDate
      ? so.value.requestedShipDate.slice(0, 10)
      : "";
    syncTrackEdits(so.value);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

function shipmentQty(s: SalesOrder["shipments"][number]): number {
  return s.lines.reduce((n, l) => n + Number(l.quantity), 0);
}

async function saveTracking(shipmentId: string): Promise<void> {
  if (!so.value) return;
  error.value = null;
  notice.value = null;
  trackBusy.value = shipmentId;
  try {
    const edit = trackEdits[shipmentId]!;
    so.value = await api.updateShipment(so.value.id, shipmentId, {
      carrier: edit.carrier.trim() || null,
      trackingNumber: edit.trackingNumber.trim() || null,
      notes: edit.notes.trim() || null,
    });
    syncTrackEdits(so.value);
    notice.value = "Tracking updated.";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Update failed";
  } finally {
    trackBusy.value = null;
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
    so.value = await api.shipSalesOrder(props.id, {
      lines,
      carrier: shipMeta.carrier.trim() || undefined,
      trackingNumber: shipMeta.trackingNumber.trim() || undefined,
      notes: shipMeta.notes.trim() || undefined,
    });
    for (const line of so.value.lines) shipQty[line.id] = "0";
    shipMeta.carrier = "";
    shipMeta.trackingNumber = "";
    shipMeta.notes = "";
    syncTrackEdits(so.value);
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
        <button v-if="canMarkPaid" :disabled="prodBusy" @click="markPaid">Mark paid</button>
        <button
          v-if="canRequestProduction"
          class="primary"
          :disabled="prodBusy || !isRequestable"
          :title="
            isRequestable
              ? ''
              : 'Mark the order paid, or set net terms on the customer, before requesting production.'
          "
          @click="requestProduction"
        >
          Request production
        </button>
        <button v-if="canCancel" class="danger" @click="cancel">Cancel SO</button>
      </div>
      <div
        v-if="canRequestProduction && !isRequestable"
        class="banner"
        style="margin-bottom: 1rem"
      >
        Mark the order paid, or set net terms on the customer, before requesting
        production.
      </div>
      <div class="summary" style="margin-bottom: 1rem">
        <div class="metric"><div class="label">Customer</div><div class="value" style="font-size: 1rem">{{ so.customerName }}</div></div>
        <div class="metric"><div class="label">Status</div><div class="value" style="font-size: 1rem">{{ so.status }}</div></div>
        <div class="metric"><div class="label">Revenue</div><div class="value">${{ so.totalRevenue }}</div></div>
        <div class="metric">
          <div class="label">Ship by</div>
          <div v-if="canEditShipDate" class="value" style="font-size: 0.9rem; display: flex; gap: 0.3rem; align-items: center">
            <input v-model="shipDateEdit" type="date" style="max-width: 150px" />
            <button :disabled="shipDateBusy || !shipDateEdit" @click="saveShipDate">
              {{ shipDateBusy ? "…" : "Save" }}
            </button>
          </div>
          <div v-else class="value" style="font-size: 1rem">
            {{ so.requestedShipDate ? new Date(so.requestedShipDate).toLocaleDateString() : "—" }}
          </div>
        </div>
        <div class="metric">
          <div class="label">Paid</div>
          <div class="value" style="font-size: 1rem">
            {{ so.paidAt ? new Date(so.paidAt).toLocaleDateString() : "—" }}
          </div>
        </div>
        <div class="metric">
          <div class="label">Packed</div>
          <div class="value" style="font-size: 1rem">
            {{ so.packedAt ? new Date(so.packedAt).toLocaleDateString() : "—" }}
          </div>
        </div>
      </div>

      <div v-if="so.workOrders.length" class="banner" style="margin-bottom: 1rem">
        <strong>Production work orders:</strong>
        <span v-for="(w, i) in so.workOrders" :key="w.id">
          <template v-if="i > 0">, </template>
          <RouterLink :to="{ name: 'production-detail', params: { id: w.id } }">
            {{ w.workOrderNumber }}
          </RouterLink>
          ({{ w.status }})
        </span>
      </div>

      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th class="num">Ordered</th>
            <th class="num">Shipped</th>
            <th class="num">Remaining</th>
            <th class="num">Unit price</th>
            <th>Container</th>
            <th>Production</th>
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
            <td>
              <template v-if="line.containerId">
                {{ line.containerQuantity }} × {{ line.containerName }}
                <span class="inactive">({{ line.containerSku }})</span>
              </template>
              <span v-else class="inactive">—</span>
            </td>
            <td :class="{ pending: productionPending(line.id) }">
              <template v-if="lineWorkOrder(line.id)">
                {{ lineWorkOrder(line.id)!.status }}
              </template>
              <span v-else class="inactive">—</span>
            </td>
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

      <div v-if="hasContainers" class="toolbar" style="align-items: center">
        <span v-if="so.packedAt" class="inactive">
          Packed {{ new Date(so.packedAt).toLocaleString() }} — containers deducted.
        </span>
        <span v-else class="inactive">
          Packing consumes the selected containers from inventory.
        </span>
        <span class="spacer" />
        <button v-if="canPack" class="primary" :disabled="packBusy" @click="pack">
          {{ packBusy ? "Packing…" : "Package order" }}
        </button>
      </div>

      <div v-if="canShip" class="toolbar" style="flex-wrap: wrap; align-items: center">
        <input v-model="shipMeta.carrier" placeholder="Carrier (e.g. UPS)" style="max-width: 160px" />
        <input v-model="shipMeta.trackingNumber" placeholder="Tracking #" style="max-width: 200px" />
        <input v-model="shipMeta.notes" placeholder="Notes (optional)" style="max-width: 220px" />
        <span class="spacer" />
        <button class="primary" :disabled="busy" @click="ship">
          {{ busy ? "Posting…" : "Post shipment" }}
        </button>
      </div>

      <template v-if="so.shipments.length">
        <h3 style="margin-top: 1.5rem">Shipments</h3>
        <p class="inactive" style="font-size: 0.85rem">
          Each despatch against this order — its own numbered record with carrier
          and tracking. Stock was reduced at cost (COGS) when posted; carrier and
          tracking can be edited after the fact.
        </p>
        <table>
          <thead>
            <tr>
              <th>Shipment</th><th>When</th><th>By</th>
              <th class="num">Qty</th><th class="num">COGS</th>
              <th>Carrier</th><th>Tracking</th><th>Notes</th>
              <th v-if="canShip"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in so.shipments" :key="s.id">
              <td>{{ s.shipmentNumber }}</td>
              <td>{{ new Date(s.shippedAt).toLocaleString() }}</td>
              <td>{{ s.shippedByName ?? "—" }}</td>
              <td class="num">{{ shipmentQty(s) }}</td>
              <td class="num">${{ s.totalValue }}</td>
              <template v-if="canShip && trackEdits[s.id]">
                <td><input v-model="trackEdits[s.id]!.carrier" style="max-width: 120px" /></td>
                <td><input v-model="trackEdits[s.id]!.trackingNumber" style="max-width: 160px" /></td>
                <td><input v-model="trackEdits[s.id]!.notes" style="max-width: 160px" /></td>
                <td>
                  <button :disabled="trackBusy === s.id" @click="saveTracking(s.id)">
                    {{ trackBusy === s.id ? "Saving…" : "Save" }}
                  </button>
                </td>
              </template>
              <template v-else>
                <td>{{ s.carrier ?? "—" }}</td>
                <td>{{ s.trackingNumber ?? "—" }}</td>
                <td>{{ s.notes ?? "—" }}</td>
              </template>
            </tr>
          </tbody>
        </table>
      </template>
    </div>
  </div>
</template>

<style scoped>
.pending {
  color: #b45309;
  font-weight: 600;
}
</style>
