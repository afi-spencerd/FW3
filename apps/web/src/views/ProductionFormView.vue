<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  createProductionRunSchema,
  type FormulaSummary,
  type InventoryItem,
  UNITS_OF_MEASURE,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";

const router = useRouter();
const targets = ref<InventoryItem[]>([]);
const formulas = ref<FormulaSummary[]>([]);
const issues = ref<string[]>([]);
const busy = ref(false);

const form = reactive({
  runNumber: "",
  targetItemId: "",
  formulaId: "",
  batchSize: "0",
  batchUnit: "LB" as (typeof UNITS_OF_MEASURE)[number],
  outputQty: "0",
  notes: "",
});

// Formulas whose target is the selected item.
const formulaChoices = computed(() =>
  formulas.value.filter((f) => f.finishedGoodId === form.targetItemId),
);

onMounted(async () => {
  try {
    const [inv, f] = await Promise.all([
      api.listInventory({ pageSize: 200 }),
      api.listFormulas(),
    ]);
    // Producible targets: finished goods and bases.
    targets.value = inv.items.filter((i) => i.itemType !== "RAW_MATERIAL");
    formulas.value = f;
  } catch (err) {
    issues.value = [err instanceof ApiError ? err.message : "Failed to load"];
  }
});

async function submit(): Promise<void> {
  issues.value = [];
  busy.value = true;
  try {
    const payload = {
      runNumber: form.runNumber,
      targetItemId: form.targetItemId,
      formulaId: form.formulaId,
      batchSize: form.batchSize,
      batchUnit: form.batchUnit,
      outputQty: form.outputQty,
      notes: form.notes || undefined,
    };
    const parsed = createProductionRunSchema.safeParse(payload);
    if (!parsed.success) {
      issues.value = parsed.error.issues.map(
        (i) => `${i.path.join(".") || "form"}: ${i.message}`,
      );
      return;
    }
    const created = await api.createProductionRun(parsed.data);
    await router.push({ name: "production-detail", params: { id: created.id } });
  } catch (err) {
    if (err instanceof ApiError) {
      issues.value = err.issues?.length
        ? err.issues.map((i) => `${i.path || "form"}: ${i.message}`)
        : [err.message];
    } else {
      issues.value = ["Save failed"];
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="container" style="max-width: 640px">
    <div class="panel">
      <h2>New production run</h2>
      <ul v-if="issues.length" class="banner error" style="margin: 0 0 1rem; padding-left: 1.5rem">
        <li v-for="(m, i) in issues" :key="i">{{ m }}</li>
      </ul>

      <div class="field">
        <label>Run number</label>
        <input v-model="form.runNumber" />
      </div>
      <div class="field">
        <label>Target (finished good or base)</label>
        <select v-model="form.targetItemId">
          <option value="" disabled>Select a target…</option>
          <option v-for="t in targets" :key="t.id" :value="t.id">
            {{ t.name }} ({{ t.sku }})
          </option>
        </select>
      </div>
      <div class="field">
        <label>Formula</label>
        <select v-model="form.formulaId" :disabled="!form.targetItemId">
          <option value="" disabled>Select a formula…</option>
          <option v-for="f in formulaChoices" :key="f.id" :value="f.id">
            {{ f.name }} (v{{ f.version }})
          </option>
        </select>
      </div>
      <div class="grid-2">
        <div class="field">
          <label>Batch size</label>
          <input v-model="form.batchSize" inputmode="decimal" />
        </div>
        <div class="field">
          <label>Batch unit</label>
          <select v-model="form.batchUnit">
            <option v-for="u in UNITS_OF_MEASURE" :key="u" :value="u">{{ u }}</option>
          </select>
        </div>
        <div class="field">
          <label>Output quantity (in target's UoM)</label>
          <input v-model="form.outputQty" inputmode="decimal" />
        </div>
      </div>
      <div class="field">
        <label>Notes</label>
        <input v-model="form.notes" />
      </div>

      <div class="toolbar">
        <button class="primary" :disabled="busy" @click="submit">
          {{ busy ? "Saving…" : "Create run" }}
        </button>
        <button @click="router.push({ name: 'production' })">Cancel</button>
      </div>
    </div>
  </div>
</template>
