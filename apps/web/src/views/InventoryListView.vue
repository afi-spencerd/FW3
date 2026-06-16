<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { PERMISSIONS, type InventoryItem } from "@fw3/shared-types";
import { api, ApiError, type ValuationSummary } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();

const items = ref<InventoryItem[]>([]);
const total = ref(0);
const valuation = ref<ValuationSummary | null>(null);
const search = ref("");
const loading = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const [page, val] = await Promise.all([
      api.listInventory({ search: search.value || undefined, pageSize: 100 }),
      api.valuation(),
    ]);
    items.value = page.items;
    total.value = page.total;
    valuation.value = val;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  } finally {
    loading.value = false;
  }
}

async function remove(item: InventoryItem): Promise<void> {
  if (!confirm(`Delete ${item.sku}?`)) return;
  try {
    await api.deleteInventory(item.id);
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Delete failed";
  }
}

async function syncQuickBooks(): Promise<void> {
  notice.value = null;
  try {
    const res = await api.qbSync();
    notice.value = `QuickBooks sync queued (job ${res.jobId}).`;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Sync failed";
  }
}

onMounted(load);
</script>

<template>
  <div class="container">
    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="notice" class="banner ok">{{ notice }}</div>

    <div v-if="valuation" class="panel summary" style="margin-bottom: 1rem">
      <div class="metric">
        <div class="label">Items</div>
        <div class="value">{{ valuation.itemCount }}</div>
      </div>
      <div class="metric">
        <div class="label">Total quantity</div>
        <div class="value">{{ valuation.totalQuantity }}</div>
      </div>
      <div class="metric">
        <div class="label">Total value</div>
        <div class="value">${{ valuation.totalValue }}</div>
      </div>
    </div>

    <div class="toolbar">
      <input
        v-model="search"
        placeholder="Search SKU or name…"
        style="max-width: 280px"
        @keyup.enter="load"
      />
      <button @click="load">Search</button>
      <span class="spacer" />
      <button
        v-if="auth.hasPermission(PERMISSIONS.QB_SYNC_RUN)"
        @click="syncQuickBooks"
      >
        Sync QuickBooks
      </button>
      <RouterLink
        v-if="auth.hasPermission(PERMISSIONS.INVENTORY_CREATE)"
        class="btn primary"
        :to="{ name: 'inventory-new' }"
      >
        New item
      </RouterLink>
    </div>

    <div class="panel">
      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Name</th>
            <th>UoM</th>
            <th class="num">Qty</th>
            <th class="num">Unit cost</th>
            <th class="num">Sales price</th>
            <th class="num">Ext. value</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id" :class="{ inactive: !item.active }">
            <td>{{ item.sku }}</td>
            <td>{{ item.name }}</td>
            <td>{{ item.unitOfMeasure }}</td>
            <td class="num">{{ item.quantityOnHand }}</td>
            <td class="num">{{ item.unitCost }}</td>
            <td class="num">{{ item.salesPrice }}</td>
            <td class="num">{{ item.extendedValue }}</td>
            <td>
              <RouterLink
                v-if="auth.hasPermission(PERMISSIONS.INVENTORY_UPDATE)"
                :to="{ name: 'inventory-edit', params: { id: item.id } }"
              >
                Edit
              </RouterLink>
              <button
                v-if="auth.hasPermission(PERMISSIONS.INVENTORY_DELETE)"
                class="danger"
                style="margin-left: 0.5rem"
                @click="remove(item)"
              >
                Delete
              </button>
            </td>
          </tr>
          <tr v-if="!loading && items.length === 0">
            <td colspan="8" class="inactive">No items.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
