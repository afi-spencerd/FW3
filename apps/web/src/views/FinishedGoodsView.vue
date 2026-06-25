<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { RouterLink } from "vue-router";
import {
  type ComplianceStatus,
  type FgRegulatorySummary,
  type InventoryItem,
  PERMISSIONS,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const items = ref<InventoryItem[]>([]);
const reg = reactive<Record<string, FgRegulatorySummary>>({});
const error = ref<string | null>(null);
const search = ref("");

const COMPLIANCE_LABELS: Record<ComplianceStatus, string> = {
  UNKNOWN: "—",
  COMPLIANT: "Compliant",
  NON_COMPLIANT: "Non-compliant",
  PENDING: "Pending",
};

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return items.value;
  return items.value.filter(
    (i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q),
  );
});

async function load(): Promise<void> {
  error.value = null;
  try {
    const [page, summary] = await Promise.all([
      api.listInventory({ itemType: "FINISHED_GOOD", pageSize: 200 }),
      api.fgRegulatorySummary(),
    ]);
    items.value = page.items;
    for (const key of Object.keys(reg)) delete reg[key];
    for (const s of summary) reg[s.itemId] = s;
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
      <h2 style="margin: 0">Finished goods</h2>
      <span class="spacer" />
      <input v-model="search" placeholder="Search SKU or name…" style="max-width: 240px" />
      <RouterLink
        v-if="auth.hasPermission(PERMISSIONS.INVENTORY_CREATE)"
        class="btn primary"
        :to="{ name: 'inventory-new', query: { type: 'FINISHED_GOOD', return: 'finished-goods' } }"
      >
        New finished good
      </RouterLink>
    </div>
    <p class="inactive" style="font-size: 0.85rem">
      Finished fragrances and their regulatory status. Compliance, flash point,
      and allergens come from FormPak+ (refresh on the item's detail page);
      Prop 65 / CAS / IFRA concentrations are derived from the formula's raw
      materials.
    </p>

    <div class="panel">
      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Name</th>
            <th>Compliance</th>
            <th class="num">Flash pt (°C)</th>
            <th>FormPak+ synced</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in filtered" :key="item.id" :class="{ inactive: !item.active }">
            <td>{{ item.sku }}</td>
            <td>{{ item.name }}</td>
            <td
              :class="{
                warn: reg[item.id]?.complianceStatus === 'NON_COMPLIANT',
              }"
            >
              {{ reg[item.id] ? COMPLIANCE_LABELS[reg[item.id]!.complianceStatus!] : "not synced" }}
            </td>
            <td class="num">{{ reg[item.id]?.flashPointC ?? "—" }}</td>
            <td>
              <span v-if="reg[item.id]?.syncedAt">
                {{ new Date(reg[item.id]!.syncedAt!).toLocaleDateString() }}
              </span>
              <span v-else class="inactive">never</span>
            </td>
            <td>
              <RouterLink
                v-if="auth.hasPermission(PERMISSIONS.INVENTORY_READ)"
                :to="{ name: 'inventory-edit', params: { id: item.id }, query: { return: 'finished-goods' } }"
              >
                Details
              </RouterLink>
            </td>
          </tr>
          <tr v-if="filtered.length === 0"><td colspan="6" class="inactive">No finished goods.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.warn {
  color: #b45309;
  font-weight: 600;
}
</style>
