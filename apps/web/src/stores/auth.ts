import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { AuthenticatedUser, Permission } from "@fw3/shared-types";
import { api } from "../lib/api";

export const useAuthStore = defineStore("auth", () => {
  const user = ref<AuthenticatedUser | null>(null);
  const ready = ref(false);

  const isAuthenticated = computed(() => user.value !== null);

  function hasPermission(permission: Permission): boolean {
    return user.value?.permissions.includes(permission) ?? false;
  }

  /** Resolve the current session once on app start. */
  async function init(): Promise<void> {
    try {
      user.value = await api.me();
    } catch {
      user.value = null;
    } finally {
      ready.value = true;
    }
  }

  async function devLogin(tenant: string): Promise<void> {
    user.value = await api.devLogin(tenant);
  }

  async function logout(): Promise<void> {
    await api.logout();
    user.value = null;
  }

  return { user, ready, isAuthenticated, hasPermission, init, devLogin, logout };
});
