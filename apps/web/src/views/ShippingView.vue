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
    await api.shipSalesOrder(order.id, { lines });
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

      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th class="num">Ordered</th>
            <th class="num">Shipped</th>
            <th class="num">Remaining</th>
            <th class="num">Available</th>
            <th v-if="canShip" class="num">Ship now</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="line in o.lines"
            :key="line.id"
            :class="{ inactive: remaining(line.quantityOrdered, line.quantityShipped) <= 0 }"
          >
            <td>{{ line.itemName }} <span class="inactive">({{ line.itemSku }})</span></td>
            <td class="num">{{ line.quantityOrdered }}</td>
            <td class="num">{{ line.quantityShipped }}</td>
            <td class="num">{{ remaining(line.quantityOrdered, line.quantityShipped) }}</td>
            <td
              class="num"
              :class="{ short: available(line.itemId) < remaining(line.quantityOrdered, line.quantityShipped) }"
            >
              {{ available(line.itemId) }}
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

      <div v-if="canShip" class="toolbar">
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
</style>
