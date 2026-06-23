<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { RouterLink } from "vue-router";
import { PERMISSIONS, type SalesOrder } from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const orders = ref<SalesOrder[]>([]);
// itemId -> usable (INV) quantity on hand, from the stock ledger.
const onHand = reactive<Record<string, string>>({});
// salesOrderLineId -> quantity to ship now.
const shipQty = reactive<Record<string, string>>({});
// salesOrderId -> carrier / tracking / notes for the despatch being entered.
const shipMeta = reactive<
  Record<string, { carrier: string; trackingNumber: string; notes: string }>
>({});
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const loading = ref(false);
const busyId = ref<string | null>(null);

const canShip = auth.hasPermission(PERMISSIONS.SO_SHIP);

function remaining(ordered: string, shipped: string): number {
  return Number(ordered) - Number(shipped);
}
function available(itemId: string): number {
  return Number(onHand[itemId] ?? "0");
}
type SoLine = SalesOrder["lines"][number];
function subjectName(line: SoLine): string {
  return (line.lineType === "CONTAINER" ? line.productContainerName : line.itemName) ?? "—";
}
function subjectSku(line: SoLine): string {
  return (line.lineType === "CONTAINER" ? line.productContainerSku : line.itemSku) ?? "";
}
// Item availability comes from the INV ledger; container availability isn't loaded
// here (the server enforces container stock at ship time).
function lineAvailable(line: SoLine): number | null {
  return line.lineType === "ITEM" && line.itemId ? available(line.itemId) : null;
}

// The production work order backing a line (prefer an unfinished one), if any.
function lineWorkOrder(o: SalesOrder, lineId: string) {
  const wos = o.workOrders.filter((w) => w.salesOrderLineId === lineId);
  if (wos.length === 0) return null;
  return (
    wos.find((w) => w.status !== "COMPLETED" && w.status !== "CANCELLED") ?? wos[0]
  );
}
// A line is flagged when its production WO isn't finished — those goods can't ship yet.
function productionPending(o: SalesOrder, lineId: string): boolean {
  const wo = lineWorkOrder(o, lineId);
  return !!wo && wo.status !== "COMPLETED" && wo.status !== "CANCELLED";
}
function orderHasPending(o: SalesOrder): boolean {
  return o.lines.some((l) => productionPending(o, l.id));
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [pending, positions] = await Promise.all([
      api.pendingShipments(),
      api.stockPositions(),
    ]);
    orders.value = pending;
    for (const key of Object.keys(onHand)) delete onHand[key];
    for (const p of positions) {
      if (p.status === "INV") onHand[p.itemId] = p.quantity;
    }
    for (const o of orders.value) {
      for (const line of o.lines) shipQty[line.id] = "0";
      shipMeta[o.id] = { carrier: "", trackingNumber: "", notes: "" };
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  } finally {
    loading.value = false;
  }
}

async function ship(order: SalesOrder): Promise<void> {
  notice.value = null;
  error.value = null;
  const lines = order.lines
    .filter((l) => Number(shipQty[l.id]) > 0)
    .map((l) => ({ salesOrderLineId: l.id, quantity: shipQty[l.id]! }));
  if (lines.length === 0) {
    error.value = "Enter a quantity to ship on at least one line.";
    return;
  }
  busyId.value = order.id;
  try {
    const meta = shipMeta[order.id];
    await api.shipSalesOrder(order.id, {
      lines,
      carrier: meta?.carrier.trim() || undefined,
      trackingNumber: meta?.trackingNumber.trim() || undefined,
      notes: meta?.notes.trim() || undefined,
    });
    notice.value = `Shipment posted for ${order.soNumber} — inventory reduced at cost (COGS).`;
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Shipment failed";
  } finally {
    busyId.value = null;
  }
}

const totalRemaining = computed(() =>
  orders.value.reduce(
    (sum, o) =>
      sum +
      o.lines.reduce(
        (s, l) => s + remaining(l.quantityOrdered, l.quantityShipped),
        0,
      ),
    0,
  ),
);
</script>

<template>
  <div class="container">
    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="notice" class="banner ok">{{ notice }}</div>

    <div class="toolbar">
      <h2 style="margin: 0">Shipping — pending sales orders</h2>
      <span class="spacer" />
      <button @click="load">Refresh</button>
    </div>
    <p class="inactive" style="font-size: 0.85rem">
      Open and partially-shipped orders awaiting fulfillment, oldest first.
      Available is usable (traceable) stock on hand; shipping reduces inventory
      at average cost. Ordered/shipped totals and full order detail are on the
      sales order page.
    </p>

    <div v-if="!loading && orders.length === 0" class="panel inactive">
      Nothing to ship — all orders are fulfilled.
    </div>

    <div v-for="o in orders" :key="o.id" class="panel" style="margin-bottom: 1rem">
      <div class="toolbar">
        <h3 style="margin: 0">
          <RouterLink :to="{ name: 'sales-order-detail', params: { id: o.id } }">
            {{ o.soNumber }}
          </RouterLink>
        </h3>
        <span class="badge">{{ o.status }}</span>
        <span class="spacer" />
        <span class="inactive">{{ o.customerName }}</span>
        <span class="inactive">· ordered {{ new Date(o.orderDate).toLocaleDateString() }}</span>
      </div>

      <div v-if="orderHasPending(o)" class="banner warn">
        Some lines' production isn't complete (see the Production column). Ship the
        ready lines now; the rest follow once produced.
      </div>

      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th class="num">Ordered</th>
            <th class="num">Shipped</th>
            <th class="num">Remaining</th>
            <th class="num">Available</th>
            <th>Production</th>
            <th v-if="canShip" class="num">Ship now</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="line in o.lines"
            :key="line.id"
            :class="{ inactive: remaining(line.quantityOrdered, line.quantityShipped) <= 0 }"
          >
            <td>
              {{ subjectName(line) }} <span class="inactive">({{ subjectSku(line) }})</span>
              <span v-if="line.lineType === 'CONTAINER'" class="badge">container</span>
            </td>
            <td class="num">{{ line.quantityOrdered }}</td>
            <td class="num">{{ line.quantityShipped }}</td>
            <td class="num">{{ remaining(line.quantityOrdered, line.quantityShipped) }}</td>
            <td
              class="num"
              :class="{ short: lineAvailable(line) !== null && lineAvailable(line)! < remaining(line.quantityOrdered, line.quantityShipped) }"
            >
              <template v-if="lineAvailable(line) !== null">{{ lineAvailable(line) }}</template>
              <span v-else class="inactive">—</span>
            </td>
            <td :class="{ pending: productionPending(o, line.id) }">
              <template v-if="lineWorkOrder(o, line.id)">
                {{ lineWorkOrder(o, line.id)!.workOrderNumber }}
                <span class="inactive">({{ lineWorkOrder(o, line.id)!.status }})</span>
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

      <template v-if="o.shipments.length">
        <h4 style="margin-bottom: 0.3rem">Shipped so far</h4>
        <table class="sub">
          <thead>
            <tr><th>Shipment</th><th>When</th><th>Carrier</th><th>Tracking</th><th class="num">Qty</th></tr>
          </thead>
          <tbody>
            <tr v-for="s in o.shipments" :key="s.id">
              <td>{{ s.shipmentNumber }}</td>
              <td>{{ new Date(s.shippedAt).toLocaleString() }}</td>
              <td>{{ s.carrier ?? "—" }}</td>
              <td>{{ s.trackingNumber ?? "—" }}</td>
              <td class="num">{{ s.lines.reduce((n, l) => n + Number(l.quantity), 0) }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <div v-if="canShip && shipMeta[o.id]" class="ship-controls">
        <input v-model="shipMeta[o.id]!.carrier" placeholder="Carrier (e.g. UPS)" style="max-width: 160px" />
        <input v-model="shipMeta[o.id]!.trackingNumber" placeholder="Tracking #" style="max-width: 200px" />
        <input v-model="shipMeta[o.id]!.notes" placeholder="Notes (optional)" />
        <span class="spacer" />
        <button
          class="primary"
          :disabled="busyId === o.id"
          @click="ship(o)"
        >
          {{ busyId === o.id ? "Posting…" : "Post shipment" }}
        </button>
      </div>
    </div>

    <p v-if="orders.length" class="inactive" style="font-size: 0.85rem">
      {{ orders.length }} order(s) pending, {{ totalRemaining }} unit(s) remaining to ship.
    </p>
  </div>
</template>

<style scoped>
.badge {
  font-size: 0.75rem;
  background: #e0e7ff;
  color: #3730a3;
  padding: 0.1rem 0.45rem;
  border-radius: 0.3rem;
  margin-left: 0.5rem;
}
.short {
  color: #b45309;
  font-weight: 600;
}
.pending {
  color: #b45309;
  font-weight: 600;
}
.banner.warn {
  background: #fffbeb;
  color: #92400e;
  border: 1px solid #fde68a;
  margin: 0.5rem 0;
}
.ship-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
.ship-controls input {
  flex: 1 1 auto;
}
table.sub {
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
}
</style>
