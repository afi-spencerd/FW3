<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { ApiError } from "../lib/api";

const auth = useAuthStore();
const router = useRouter();
const tenant = ref("demo");
const error = ref<string | null>(null);
const busy = ref(false);

async function signIn(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    await auth.devLogin(tenant.value);
    await router.push({ name: "inventory" });
  } catch (err) {
    error.value =
      err instanceof ApiError ? err.message : "Sign-in failed";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="container" style="max-width: 420px">
    <div class="panel">
      <h2>Sign in</h2>
      <p class="inactive">
        Microsoft Entra (OIDC) sign-in is not wired yet. Use the local
        development login below.
      </p>
      <div v-if="error" class="banner error">{{ error }}</div>
      <div class="field">
        <label for="tenant">Tenant</label>
        <input id="tenant" v-model="tenant" @keyup.enter="signIn" />
      </div>
      <button class="primary" :disabled="busy" @click="signIn">
        {{ busy ? "Signing in…" : "Dev sign-in" }}
      </button>
    </div>
  </div>
</template>
