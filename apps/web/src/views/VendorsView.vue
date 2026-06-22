<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { PERMISSIONS, type Vendor } from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const vendors = ref<Vendor[]>([]);
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

async function load(): Promise<void> {
  error.value = null;
  try {
    vendors.value = await api.listVendors();
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
          <tr><th>Name</th><th>Code</th><th>Email</th><th>Phone</th><th>Terms</th><th class="num">Addr</th><th class="num">Contacts</th><th>Active</th></tr>
        </thead>
        <tbody>
          <tr v-for="v in filtered" :key="v.id" :class="{ inactive: !v.isActive }">
            <td>
              <RouterLink :to="{ name: 'vendor-detail', params: { id: v.id } }">{{ v.name }}</RouterLink>
            </td>
            <td>{{ v.code }}</td>
            <td>{{ v.email }}</td>
            <td>{{ v.phone }}</td>
            <td>{{ v.paymentTerms ? v.paymentTerms.replace(/_/g, " ") : "" }}</td>
            <td class="num">{{ v.addresses.length }}</td>
            <td class="num">{{ v.contacts.length }}</td>
            <td>{{ v.isActive ? "Yes" : "No" }}</td>
          </tr>
          <tr v-if="filtered.length === 0"><td colspan="8" class="inactive">No vendors.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
