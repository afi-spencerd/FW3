<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { PERMISSIONS, type FormulaSummary } from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const formulas = ref<FormulaSummary[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    formulas.value = await api.listFormulas();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  } finally {
    loading.value = false;
  }
}

async function remove(formula: FormulaSummary): Promise<void> {
  if (!confirm(`Delete formula "${formula.name}"?`)) return;
  try {
    await api.deleteFormula(formula.id);
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Delete failed";
  }
}

onMounted(load);
</script>

<template>
  <div class="container">
    <div v-if="error" class="banner error">{{ error }}</div>

    <div class="toolbar">
      <h2 style="margin: 0">Formulas</h2>
      <span class="spacer" />
      <RouterLink
        v-if="auth.hasPermission(PERMISSIONS.FORMULA_CREATE)"
        class="btn primary"
        :to="{ name: 'formula-new' }"
      >
        New formula
      </RouterLink>
    </div>

    <div class="panel">
      <table>
        <thead>
          <tr>
            <th>Formula</th>
            <th>Finished good</th>
            <th class="num">Version</th>
            <th class="num">Lines</th>
            <th>Active</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in formulas" :key="f.id" :class="{ inactive: !f.isActive }">
            <td>{{ f.name }}</td>
            <td>{{ f.finishedGoodName }} <span class="inactive">({{ f.finishedGoodSku }})</span></td>
            <td class="num">{{ f.version }}</td>
            <td class="num">{{ f.lineCount }}</td>
            <td>{{ f.isActive ? "Yes" : "No" }}</td>
            <td>
              <RouterLink :to="{ name: 'formula-edit', params: { id: f.id } }">
                {{ auth.hasPermission(PERMISSIONS.FORMULA_UPDATE) ? "Edit" : "View" }}
              </RouterLink>
              <button
                v-if="auth.hasPermission(PERMISSIONS.FORMULA_DELETE)"
                class="danger"
                style="margin-left: 0.5rem"
                @click="remove(f)"
              >
                Delete
              </button>
            </td>
          </tr>
          <tr v-if="!loading && formulas.length === 0">
            <td colspan="6" class="inactive">No formulas yet.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
