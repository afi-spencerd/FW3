<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import {
  type CycleCountStatus,
  type CycleCountSummary,
  CYCLE_COUNT_STATUSES,
  PERMISSIONS,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const counts = ref<CycleCountSummary[]>([]);
const statusFilter = ref<CycleCountStatus | "">("");
const error = ref<string | null>(null);

async function load(): Promise<void> {
  error.value = null;
  try {
    counts.value = await api.listCycleCounts(statusFilter.value || undefined);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

onMounted(load);
</script>

<template>
  <div class="container">
    <div v-if="error" class="banner error">{{ error }}</div>

    <div class="toolbar" style="margin-bottom: 1rem; align-items: center">
      <h2 style="margin: 0">Cycle counts</h2>
      <span class="spacer" />
      <select v-model="statusFilter" style="max-width: 160px" @change="load">
        <option value="">All statuses</option>
        <option v-for="s in CYCLE_COUNT_STATUSES" :key="s" :value="s">{{ s }}</option>
      </select>
      <RouterLink
        v-if="auth.hasPermission(PERMISSIONS.CYCLE_COUNT_MANAGE)"
        :to="{ name: 'cycle-count-new' }"
      >
        <button class="primary">New cycle count</button>
      </RouterLink>
    </div>

    <div class="panel">
      <table>
        <thead>
          <tr>
            <th>Reference</th><th>Status</th><th>Scope</th>
            <th class="num">Lines</th><th class="num">Counted</th><th class="num">Variances</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in counts" :key="c.id">
            <td>
              <RouterLink :to="{ name: 'cycle-count-detail', params: { id: c.id } }">
                {{ c.reference }}
              </RouterLink>
            </td>
            <td>{{ c.status }}</td>
            <td>{{ c.scopeLabel }}<span v-if="c.blind" class="inactive"> · blind</span></td>
            <td class="num">{{ c.lineCount }}</td>
            <td class="num">{{ c.countedCount }}</td>
            <td class="num" :class="{ inactive: c.varianceCount === 0 }">{{ c.varianceCount }}</td>
            <td>{{ new Date(c.createdAt).toLocaleDateString() }}</td>
          </tr>
          <tr v-if="counts.length === 0">
            <td colspan="7" class="inactive">No cycle counts yet.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
