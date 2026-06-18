<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  createProductionWorkOrderSchema,
  type FormulaSummary,
  type InventoryItem,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";

const router = useRouter();
const targets = ref<InventoryItem[]>([]);
const formulas = ref<FormulaSummary[]>([]);
const issues = ref<string[]>([]);
const busy = ref(false);

const form = reactive({
  workOrderNumber: "",
  targetItemId: "",
  formulaId: "",
  batchSize: "0",
  batchUnit: "LB" as const,
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
      workOrderNumber: form.workOrderNumber,
      targetItemId: form.targetItemId,
      formulaId: form.formulaId,
      batchSize: form.batchSize,
      batchUnit: form.batchUnit,
      outputQty: form.outputQty,
      notes: form.notes || undefined,
    };
    const parsed = createProductionWorkOrderSchema.safeParse(payload);
    if (!parsed.success) {
      issues.value = parsed.error.issues.map(
        (i) => `${i.path.join(".") || "form"}: ${i.message}`,
      );
      return;
    }
    const created = await api.createProductionWorkOrder(parsed.data);
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
      <h2>New production work order</h2>
      <ul v-if="issues.length" class="banner error" style="margin: 0 0 1rem; padding-left: 1.5rem">
        <li v-for="(m, i) in issues" :key="i">{{ m }}</li>
      </ul>

      <div class="field">
        <label>Work order number</label>
        <input v-model="form.workOrderNumber" />
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
          <label>Batch size (lb)</label>
          <input v-model="form.batchSize" inputmode="decimal" />
          <div class="inactive" style="font-size: 0.8rem">Batching is always in pounds.</div>
        </div>
        <div class="field">
          <label>Output quantity (lb)</label>
          <input v-model="form.outputQty" inputmode="decimal" />
        </div>
      </div>
      <div class="field">
        <label>Notes</label>
        <input v-model="form.notes" />
      </div>

      <div class="toolbar">
        <button class="primary" :disabled="busy" @click="submit">
          {{ busy ? "Saving…" : "Create work order" }}
        </button>
        <button @click="router.push({ name: 'production' })">Cancel</button>
      </div>
    </div>
  </div>
</template>
