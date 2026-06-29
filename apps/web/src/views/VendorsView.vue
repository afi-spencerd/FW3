<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { RouterLink } from "vue-router";
import {
  PAYMENT_TERMS,
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
const suppliesFilter = ref<"" | "materials" | "containers">("");
const termsFilter = ref("");
const activeFilter = ref<"" | "active" | "inactive">("");
const canManage = auth.hasPermission(PERMISSIONS.VENDOR_MANAGE);

// Sortable columns and how each maps to a comparable value.
type SortKey =
  | "name"
  | "code"
  | "email"
  | "supplies"
  | "paymentTerms"
  | "poCount"
  | "lastOrderAt"
  | "isActive";
const sortKey = ref<SortKey>("name");
const sortDir = ref<"asc" | "desc">("asc");

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return vendors.value.filter((v) => {
    if (suppliesFilter.value === "materials" && !v.suppliesMaterials) return false;
    if (suppliesFilter.value === "containers" && !v.suppliesContainers) return false;
    if (termsFilter.value && v.paymentTerms !== termsFilter.value) return false;
    if (activeFilter.value === "active" && !v.isActive) return false;
    if (activeFilter.value === "inactive" && v.isActive) return false;
    if (!q) return true;
    return (
      v.name.toLowerCase().includes(q) ||
      (v.code ?? "").toLowerCase().includes(q) ||
      (v.email ?? "").toLowerCase().includes(q)
    );
  });
});

function supplies(v: Vendor): string {
  const parts: string[] = [];
  if (v.suppliesMaterials) parts.push("Materials");
  if (v.suppliesContainers) parts.push("Containers");
  return parts.join(" + ") || "—";
}

function compare(a: Vendor, b: Vendor): number {
  switch (sortKey.value) {
    case "supplies":
      return supplies(a).localeCompare(supplies(b));
    case "poCount":
      return (summary[a.id]?.poCount ?? 0) - (summary[b.id]?.poCount ?? 0);
    case "lastOrderAt": {
      const at = summary[a.id]?.lastOrderAt;
      const bt = summary[b.id]?.lastOrderAt;
      return (at ? Date.parse(at) : 0) - (bt ? Date.parse(bt) : 0);
    }
    case "isActive":
      return Number(a.isActive) - Number(b.isActive);
    case "code":
      return (a.code ?? "").localeCompare(b.code ?? "");
    case "email":
      return (a.email ?? "").localeCompare(b.email ?? "");
    default:
      return String(a[sortKey.value] ?? "").localeCompare(
        String(b[sortKey.value] ?? ""),
      );
  }
}

const sorted = computed(() => {
  const dir = sortDir.value === "asc" ? 1 : -1;
  return [...filtered.value].sort((a, b) => compare(a, b) * dir);
});

function sortBy(key: SortKey): void {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  } else {
    sortKey.value = key;
    sortDir.value = "asc";
  }
}

function sortIndicator(key: SortKey): string {
  if (sortKey.value !== key) return "";
  return sortDir.value === "asc" ? " ▲" : " ▼";
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
      <select v-model="suppliesFilter" style="max-width: 160px">
        <option value="">All supplies</option>
        <option value="materials">Materials</option>
        <option value="containers">Containers</option>
      </select>
      <select v-model="termsFilter" style="max-width: 160px">
        <option value="">All terms</option>
        <option v-for="t in PAYMENT_TERMS" :key="t" :value="t">{{ t.replace(/_/g, " ") }}</option>
      </select>
      <select v-model="activeFilter" style="max-width: 140px">
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>
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
          <tr>
            <th class="sortable" @click="sortBy('name')">Name{{ sortIndicator("name") }}</th>
            <th class="sortable" @click="sortBy('code')">Code{{ sortIndicator("code") }}</th>
            <th class="sortable" @click="sortBy('email')">Email{{ sortIndicator("email") }}</th>
            <th class="sortable" @click="sortBy('supplies')">Supplies{{ sortIndicator("supplies") }}</th>
            <th class="sortable" @click="sortBy('paymentTerms')">Terms{{ sortIndicator("paymentTerms") }}</th>
            <th class="num sortable" @click="sortBy('poCount')">Orders{{ sortIndicator("poCount") }}</th>
            <th class="sortable" @click="sortBy('lastOrderAt')">Last ordered{{ sortIndicator("lastOrderAt") }}</th>
            <th class="sortable" @click="sortBy('isActive')">Active{{ sortIndicator("isActive") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in sorted" :key="v.id" :class="{ inactive: !v.isActive }">
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
          <tr v-if="sorted.length === 0">
            <td colspan="8" class="inactive">
              {{ vendors.length === 0 ? "No vendors." : "No matching vendors." }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
th.sortable {
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
th.sortable:hover {
  color: var(--text);
}
</style>
