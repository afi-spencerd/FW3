<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { type Container, PERMISSIONS } from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const containers = ref<Container[]>([]);
const error = ref<string | null>(null);
const search = ref("");

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return containers.value;
  return containers.value.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.sku.toLowerCase().includes(q) ||
      c.containerType.toLowerCase().includes(q),
  );
});

const totalValue = computed(() =>
  containers.value.reduce((sum, c) => sum + Number(c.totalValue), 0).toFixed(2),
);

async function load(): Promise<void> {
  error.value = null;
  try {
    containers.value = await api.listContainers();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

onMounted(load);
</script>

<template>
  <div class="container">
    <div v-if="error" class="banner error">{{ error }}</div>

    <div class="toolbar">
      <h2 style="margin: 0">Containers</h2>
      <span class="spacer" />
      <input v-model="search" placeholder="Search SKU, name, type…" style="max-width: 240px" />
      <RouterLink
        v-if="auth.hasPermission(PERMISSIONS.INVENTORY_CREATE)"
        class="btn primary"
        :to="{ name: 'container-new' }"
      >
        New container
      </RouterLink>
    </div>
    <p class="inactive" style="font-size: 0.85rem">
      Packaging stock — drums, cans, jugs, bottles. Counted in whole units;
      consumed when a sales order is packed. On-hand value ${{ totalValue }}.
    </p>

    <div class="panel">
      <table>
        <thead>
          <tr>
            <th>SKU</th><th>Name</th><th>Type</th>
            <th class="num">Capacity (lb)</th>
            <th class="num">On hand</th><th class="num">Avg cost</th><th class="num">Value</th>
            <th>Active</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in filtered" :key="c.id" :class="{ inactive: !c.active }">
            <td>
              <RouterLink :to="{ name: 'container-detail', params: { id: c.id } }">{{ c.sku }}</RouterLink>
            </td>
            <td>{{ c.name }}</td>
            <td>{{ c.containerType }}</td>
            <td class="num">{{ c.capacityLb ?? "—" }}</td>
            <td class="num">{{ c.quantityOnHand }}</td>
            <td class="num">${{ c.avgCost }}</td>
            <td class="num">${{ c.totalValue }}</td>
            <td>{{ c.active ? "Yes" : "No" }}</td>
          </tr>
          <tr v-if="filtered.length === 0"><td colspan="8" class="inactive">No containers.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
