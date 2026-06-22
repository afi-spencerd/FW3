<script setup lang="ts">
import { RouterLink, RouterView, useRouter } from "vue-router";
import { useAuthStore } from "./stores/auth";

const auth = useAuthStore();
const router = useRouter();

async function logout(): Promise<void> {
  await auth.logout();
  await router.push({ name: "login" });
}
</script>

<template>
  <header class="app-header">
    <span class="brand">fw3 ERP</span>
    <nav v-if="auth.isAuthenticated" class="nav">
      <RouterLink :to="{ name: 'inventory' }">Inventory</RouterLink>
      <RouterLink :to="{ name: 'raw-materials' }">Raw Materials</RouterLink>
      <RouterLink :to="{ name: 'locations' }">Locations</RouterLink>
      <RouterLink :to="{ name: 'cycle-counts' }">Cycle Counts</RouterLink>
      <RouterLink :to="{ name: 'quality' }">Quality</RouterLink>
      <RouterLink :to="{ name: 'formulas' }">Formulas</RouterLink>
      <RouterLink :to="{ name: 'production' }">Work Orders</RouterLink>
      <RouterLink :to="{ name: 'vendors' }">Vendors</RouterLink>
      <RouterLink :to="{ name: 'purchase-orders' }">Purchase Orders</RouterLink>
      <RouterLink :to="{ name: 'customers' }">Customers</RouterLink>
      <RouterLink :to="{ name: 'sales-orders' }">Sales Orders</RouterLink>
      <RouterLink :to="{ name: 'shipping' }">Shipping</RouterLink>
      <RouterLink :to="{ name: 'containers' }">Containers</RouterLink>
    </nav>
    <span class="spacer" />
    <template v-if="auth.isAuthenticated">
      <span class="user">{{ auth.user?.email }}</span>
      <button @click="logout">Sign out</button>
    </template>
  </header>
  <RouterView />
</template>
