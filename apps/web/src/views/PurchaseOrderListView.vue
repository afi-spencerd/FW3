<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import {
  PERMISSIONS,
  type PurchaseOrderSummary,
  type PurchasingAlert,
  type PurchasingReorder,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const orders = ref<PurchaseOrderSummary[]>([]);
const alerts = ref<PurchasingAlert[]>([]);
const reorder = ref<PurchasingReorder>({ materials: [], containers: [] });
const error = ref<string | null>(null);

async function load(): Promise<void> {
  error.value = null;
  try {
    [orders.value, alerts.value, reorder.value] = await Promise.all([
      api.listPurchaseOrders(),
      api.listPurchasingAlerts("OPEN"),
      api.purchasingReorder(),
    ]);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

async function resolveAlert(id: string): Promise<void> {
  try {
    await api.resolvePurchasingAlert(id);
    alerts.value = alerts.value.filter((a) => a.id !== id);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to resolve";
  }
}

onMounted(load);
</script>

<template>
  <div class="container">
    <div v-if="error" class="banner error">{{ error }}</div>
    <div class="toolbar">
      <h2 style="margin: 0">Purchase orders</h2>
      <span class="spacer" />
      <RouterLink
        v-if="auth.hasPermission(PERMISSIONS.PO_CREATE)"
        class="btn primary"
        :to="{ name: 'purchase-order-new' }"
      >
        New PO
      </RouterLink>
    </div>

    <div v-if="alerts.length" class="panel" style="border-left: 3px solid #b91c1c">
      <h3 style="margin-top: 0">Shortage alerts ({{ alerts.length }})</h3>
      <p class="inactive" style="font-size: 0.85rem">
        Raised by the scheduler when a work order can't be made for lack of stock.
      </p>
      <table>
        <thead>
          <tr>
            <th>Material</th>
            <th class="num">Short by</th>
            <th>Work order</th>
            <th>Note</th>
            <th>Raised by</th>
            <th v-if="auth.hasPermission(PERMISSIONS.PO_UPDATE)"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in alerts" :key="a.id">
            <td>{{ a.itemName }} <span class="inactive">({{ a.itemSku }})</span></td>
            <td class="num">{{ a.shortQty }}</td>
            <td>{{ a.workOrderNumber ?? "—" }}</td>
            <td>{{ a.note ?? "—" }}</td>
            <td>{{ a.raisedByName ?? "—" }}</td>
            <td v-if="auth.hasPermission(PERMISSIONS.PO_UPDATE)">
              <button @click="resolveAlert(a.id)">Resolve</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-if="reorder.materials.length || reorder.containers.length"
      class="panel"
      style="border-left: 3px solid #b45309"
    >
      <h3 style="margin-top: 0">
        Below reorder point ({{ reorder.materials.length + reorder.containers.length }})
      </h3>
      <p class="inactive" style="font-size: 0.85rem">
        Raw materials and containers whose usable on-hand has dropped below their
        reorder point — restock from a vendor.
      </p>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Kind</th>
            <th class="num">On hand</th>
            <th class="num">Reorder point</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in reorder.materials" :key="m.itemId">
            <td>{{ m.name }} <span class="inactive">({{ m.sku }})</span></td>
            <td class="inactive">Raw material</td>
            <td class="num">{{ m.onHand }}</td>
            <td class="num">{{ m.reorderPoint }}</td>
          </tr>
          <tr v-for="c in reorder.containers" :key="c.containerId">
            <td>{{ c.name }} <span class="inactive">({{ c.sku }})</span></td>
            <td class="inactive">Container</td>
            <td class="num">{{ c.onHand }}</td>
            <td class="num">{{ c.reorderPoint }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="panel">
      <table>
        <thead>
          <tr>
            <th>PO #</th>
            <th>Vendor</th>
            <th>Status</th>
            <th class="num">Lines</th>
            <th class="num">Total</th>
            <th>Ordered</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in orders" :key="o.id">
            <td>
              <RouterLink :to="{ name: 'purchase-order-detail', params: { id: o.id } }">
                {{ o.poNumber }}
              </RouterLink>
            </td>
            <td>{{ o.vendorName }}</td>
            <td>{{ o.status }}</td>
            <td class="num">{{ o.lineCount }}</td>
            <td class="num">${{ o.totalValue }}</td>
            <td>{{ new Date(o.orderDate).toLocaleDateString() }}</td>
          </tr>
          <tr v-if="orders.length === 0"><td colspan="6" class="inactive">No purchase orders yet.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
