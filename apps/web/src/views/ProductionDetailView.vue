<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { PERMISSIONS, type ProductionWorkOrder } from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const props = defineProps<{ id: string }>();
const router = useRouter();
const auth = useAuthStore();

const run = ref<ProductionWorkOrder | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = ref(false);

const canExecute = computed(() => auth.hasPermission(PERMISSIONS.PRODUCTION_EXECUTE));

async function load(): Promise<void> {
  error.value = null;
  try {
    run.value = await api.getProductionWorkOrder(props.id);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

async function act(fn: () => Promise<ProductionWorkOrder>, msg: string): Promise<void> {
  busy.value = true;
  error.value = null;
  notice.value = null;
  try {
    run.value = await fn();
    notice.value = msg;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Action failed";
  } finally {
    busy.value = false;
  }
}

const stage = () =>
  act(() => api.stageProductionWorkOrder(props.id), "Components staged into WIP.");
const complete = () =>
  act(
    () => api.completeProductionWorkOrder(props.id),
    "Work order completed — finished goods are in FG_WIP. Pack off from the Stock page.",
  );
const cancel = () =>
  act(() => api.cancelProductionWorkOrder(props.id), "Work order cancelled.");

onMounted(load);
</script>

<template>
  <div class="container" style="max-width: 820px">
    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="notice" class="banner ok">{{ notice }}</div>

    <div v-if="run" class="panel">
      <div class="toolbar">
        <h2 style="margin: 0">{{ run.workOrderNumber }}</h2>
        <span class="spacer" />
        <button @click="router.push({ name: 'production' })">Back</button>
      </div>
      <div class="summary" style="margin-bottom: 1rem">
        <div class="metric"><div class="label">Target</div><div class="value" style="font-size: 1rem">{{ run.targetName }}</div></div>
        <div class="metric"><div class="label">Status</div><div class="value" style="font-size: 1rem">{{ run.status }}</div></div>
        <div class="metric"><div class="label">Batch</div><div class="value" style="font-size: 1rem">{{ run.batchSize }} {{ run.batchUnit }}</div></div>
        <div class="metric"><div class="label">Output</div><div class="value" style="font-size: 1rem">{{ run.outputQty }}</div></div>
      </div>
      <p class="inactive" style="font-size: 0.85rem">Formula: {{ run.formulaName }}</p>

      <h3>Components</h3>
      <table>
        <thead>
          <tr>
            <th>Component</th>
            <th class="num">Required</th>
            <th class="num">Staged</th>
            <th class="num">Consumed</th>
            <th>Unit</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="line in run.lines" :key="line.id">
            <td>{{ line.componentName }} <span class="inactive">({{ line.componentSku }})</span></td>
            <td class="num">{{ line.requiredQty }}</td>
            <td class="num">{{ line.stagedQty }}</td>
            <td class="num">{{ line.consumedQty }}</td>
            <td>{{ line.stockingUnit }}</td>
          </tr>
        </tbody>
      </table>

      <div v-if="canExecute" class="toolbar">
        <button
          v-if="run.status === 'PLANNED'"
          class="primary"
          :disabled="busy"
          @click="stage"
        >
          Stage components (INV → WIP)
        </button>
        <button
          v-if="run.status === 'STAGED'"
          class="primary"
          :disabled="busy"
          @click="complete"
        >
          Complete (consume → FG_WIP)
        </button>
        <button v-if="run.status === 'PLANNED'" class="danger" :disabled="busy" @click="cancel">
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>
