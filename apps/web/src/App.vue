<script setup lang="ts">
import { RouterView, useRouter } from "vue-router";
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
    <span class="spacer" />
    <template v-if="auth.isAuthenticated">
      <span class="user">{{ auth.user?.email }}</span>
      <button @click="logout">Sign out</button>
    </template>
  </header>
  <RouterView />
</template>
