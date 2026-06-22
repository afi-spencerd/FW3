<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { type Customer, PERMISSIONS } from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const customers = ref<Customer[]>([]);
const error = ref<string | null>(null);
const search = ref("");
const canManage = auth.hasPermission(PERMISSIONS.CUSTOMER_MANAGE);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return customers.value;
  return customers.value.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.code ?? "").toLowerCase().includes(q) ||
      (c.email ?? "").toLowerCase().includes(q),
  );
});

async function load(): Promise<void> {
  error.value = null;
  try {
    customers.value = await api.listCustomers();
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
      <h2 style="margin: 0">Customers</h2>
      <span class="spacer" />
      <input v-model="search" placeholder="Search name, code, email…" style="max-width: 240px" />
      <RouterLink
        v-if="canManage"
        class="btn primary"
        :to="{ name: 'customer-new' }"
      >
        New customer
      </RouterLink>
    </div>

    <div class="panel">
      <table>
        <thead>
          <tr><th>Name</th><th>Rating</th><th>Code</th><th>Email</th><th>Phone</th><th>Terms</th><th class="num">Addr</th><th class="num">Contacts</th><th>Active</th></tr>
        </thead>
        <tbody>
          <tr v-for="c in filtered" :key="c.id" :class="{ inactive: !c.isActive }">
            <td>
              <RouterLink :to="{ name: 'customer-detail', params: { id: c.id } }">{{ c.name }}</RouterLink>
            </td>
            <td><strong v-if="c.rating">{{ c.rating }}</strong><span v-else class="inactive">—</span></td>
            <td>{{ c.code }}</td>
            <td>{{ c.email }}</td>
            <td>{{ c.phone }}</td>
            <td>{{ c.paymentTerms ? c.paymentTerms.replace(/_/g, " ") : "" }}</td>
            <td class="num">{{ c.addresses.length }}</td>
            <td class="num">{{ c.contacts.length }}</td>
            <td>{{ c.isActive ? "Yes" : "No" }}</td>
          </tr>
          <tr v-if="filtered.length === 0"><td colspan="9" class="inactive">No customers.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
