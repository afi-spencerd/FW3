<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { RouterLink } from "vue-router";
import {
  PERMISSIONS,
  type Vendor,
  type VendorSupplySummary,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const vendors = ref<Vendor[]>([]);
const summary = reactive<Record<string, VendorSupplySummary>>({});
const error = ref<string | null>(null);
const search = ref("");
const canManage = auth.hasPermission(PERMISSIONS.VENDOR_MANAGE);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return vendors.value;
  return vendors.value.filter(
    (v) =>
      v.name.toLowerCase().includes(q) ||
      (v.code ?? "").toLowerCase().includes(q) ||
      (v.email ?? "").toLowerCase().includes(q),
  );
});

function supplies(v: Vendor): string {
  const parts: string[] = [];
  if (v.suppliesMaterials) parts.push("Materials");
  if (v.suppliesContainers) parts.push("Containers");
  return parts.join(" + ") || "—";
}

async function load(): Promise<void> {
  error.value = null;
  try {
    const [vs, sum] = await Promise.all([
      api.listVendors(),
      api.vendorSupplySummary(),
    ]);
    vendors.value = vs;
    for (const key of Object.keys(summary)) delete summary[key];
    for (const s of sum) summary[s.vendorId] = s;
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
      <h2 style="margin: 0">Vendors</h2>
      <span class="spacer" />
      <input v-model="search" placeholder="Search name, code, email…" style="max-width: 240px" />
      <RouterLink
        v-if="canManage"
        class="btn primary"
        :to="{ name: 'vendor-new' }"
      >
        New vendor
      </RouterLink>
    </div>

    <div class="panel">
      <table>
        <thead>
          <tr><th>Name</th><th>Code</th><th>Email</th><th>Supplies</th><th>Terms</th><th class="num">Orders</th><th>Last ordered</th><th>Active</th></tr>
        </thead>
        <tbody>
          <tr v-for="v in filtered" :key="v.id" :class="{ inactive: !v.isActive }">
            <td>
              <RouterLink :to="{ name: 'vendor-detail', params: { id: v.id } }">{{ v.name }}</RouterLink>
            </td>
            <td>{{ v.code }}</td>
            <td>{{ v.email }}</td>
            <td>{{ supplies(v) }}</td>
            <td>{{ v.paymentTerms ? v.paymentTerms.replace(/_/g, " ") : "" }}</td>
            <td class="num">{{ summary[v.id]?.poCount ?? 0 }}</td>
            <td>
              <span v-if="summary[v.id]?.lastOrderAt">
                {{ new Date(summary[v.id]!.lastOrderAt!).toLocaleDateString() }}
              </span>
              <span v-else class="inactive">never</span>
            </td>
            <td>{{ v.isActive ? "Yes" : "No" }}</td>
          </tr>
          <tr v-if="filtered.length === 0"><td colspan="8" class="inactive">No vendors.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
