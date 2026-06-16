<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  type BatchRequirements,
  createFormulaSchema,
  type InventoryItem,
  UNITS_OF_MEASURE,
  updateFormulaSchema,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const props = defineProps<{ id?: string }>();
const router = useRouter();
const auth = useAuthStore();
const isEdit = computed(() => Boolean(props.id));

const finishedGoods = ref<InventoryItem[]>([]);
const rawMaterials = ref<InventoryItem[]>([]);

const form = reactive({
  finishedGoodId: "",
  name: "",
  notes: "",
  version: 1,
  isActive: true,
  lines: [] as { rawMaterialId: string; percentage: string }[],
});

const issues = ref<string[]>([]);
const busy = ref(false);

// Display-only running total (the authoritative sum check is the zod schema).
const percentTotal = computed(() =>
  form.lines.reduce((sum, l) => sum + (Number(l.percentage) || 0), 0),
);
const totalIsValid = computed(() => Math.abs(percentTotal.value - 100) < 1e-9);

function addLine(): void {
  form.lines.push({ rawMaterialId: "", percentage: "0" });
}
function removeLine(index: number): void {
  form.lines.splice(index, 1);
}

onMounted(async () => {
  try {
    const [fg, rm] = await Promise.all([
      api.listInventory({ itemType: "FINISHED_GOOD", pageSize: 200 }),
      api.listInventory({ itemType: "RAW_MATERIAL", pageSize: 200 }),
    ]);
    finishedGoods.value = fg.items;
    rawMaterials.value = rm.items;

    if (props.id) {
      const formula = await api.getFormula(props.id);
      form.finishedGoodId = formula.finishedGoodId;
      form.name = formula.name;
      form.notes = formula.notes ?? "";
      form.version = formula.version;
      form.isActive = formula.isActive;
      form.lines = formula.lines.map((l) => ({
        rawMaterialId: l.rawMaterialId,
        percentage: l.percentage,
      }));
    } else {
      addLine();
    }
  } catch (err) {
    issues.value = [err instanceof ApiError ? err.message : "Failed to load"];
  }
});

async function submit(): Promise<void> {
  issues.value = [];
  busy.value = true;
  try {
    const lines = form.lines.map((l, i) => ({
      rawMaterialId: l.rawMaterialId,
      percentage: l.percentage,
      sortOrder: i,
    }));
    const base = {
      name: form.name,
      notes: form.notes || undefined,
      version: form.version,
      isActive: form.isActive,
      lines,
    };

    if (isEdit.value && props.id) {
      const parsed = updateFormulaSchema.safeParse(base);
      if (!parsed.success) {
        issues.value = parsed.error.issues.map(
          (i) => `${i.path.join(".") || "form"}: ${i.message}`,
        );
        return;
      }
      await api.updateFormula(props.id, parsed.data);
    } else {
      const parsed = createFormulaSchema.safeParse({
        ...base,
        finishedGoodId: form.finishedGoodId,
      });
      if (!parsed.success) {
        issues.value = parsed.error.issues.map(
          (i) => `${i.path.join(".") || "form"}: ${i.message}`,
        );
        return;
      }
      await api.createFormula(parsed.data);
    }
    await router.push({ name: "formulas" });
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

// --- Batch calculator (only meaningful once the formula is saved) ---
const batchSize = ref("1");
const batchUnit = ref<(typeof UNITS_OF_MEASURE)[number]>("LB");
const requirements = ref<BatchRequirements | null>(null);
const calcError = ref<string | null>(null);

async function calculate(): Promise<void> {
  if (!props.id) return;
  calcError.value = null;
  try {
    requirements.value = await api.formulaRequirements(props.id, {
      batchSize: batchSize.value,
      unit: batchUnit.value,
    });
  } catch (err) {
    calcError.value = err instanceof ApiError ? err.message : "Calculation failed";
  }
}

</script>

<template>
  <div class="container" style="max-width: 760px">
    <div class="panel">
      <h2>{{ isEdit ? "Edit formula" : "New formula" }}</h2>
      <ul v-if="issues.length" class="banner error" style="margin: 0 0 1rem; padding-left: 1.5rem">
        <li v-for="(msg, i) in issues" :key="i">{{ msg }}</li>
      </ul>

      <div class="field">
        <label for="fg">Finished good (fragrance)</label>
        <select id="fg" v-model="form.finishedGoodId" :disabled="isEdit">
          <option value="" disabled>Select a finished good…</option>
          <option v-for="g in finishedGoods" :key="g.id" :value="g.id">
            {{ g.name }} ({{ g.sku }})
          </option>
        </select>
      </div>

      <div class="grid-2">
        <div class="field">
          <label for="name">Formula name</label>
          <input id="name" v-model="form.name" />
        </div>
        <div class="field">
          <label for="version">Version</label>
          <input id="version" v-model.number="form.version" type="number" min="1" />
        </div>
      </div>

      <div class="field">
        <label for="notes">Notes</label>
        <input id="notes" v-model="form.notes" />
      </div>

      <div class="field">
        <label><input type="checkbox" v-model="form.isActive" style="width: auto" /> Active</label>
      </div>

      <h3>Composition (% by weight)</h3>
      <table>
        <thead>
          <tr>
            <th>Raw material</th>
            <th class="num" style="width: 120px">Percent</th>
            <th style="width: 40px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in form.lines" :key="index">
            <td>
              <select v-model="line.rawMaterialId">
                <option value="" disabled>Select a raw material…</option>
                <option v-for="m in rawMaterials" :key="m.id" :value="m.id">
                  {{ m.name }} ({{ m.sku }})
                </option>
              </select>
            </td>
            <td class="num">
              <input v-model="line.percentage" inputmode="decimal" style="text-align: right" />
            </td>
            <td>
              <button class="danger" @click="removeLine(index)">✕</button>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td><button @click="addLine">+ Add material</button></td>
            <td class="num" :style="{ color: totalIsValid ? 'var(--ok)' : 'var(--danger)' }">
              <strong>{{ percentTotal.toFixed(4) }}%</strong>
            </td>
            <td></td>
          </tr>
        </tfoot>
      </table>
      <p class="inactive" style="font-size: 0.85rem">
        Percentages must sum to exactly 100.
      </p>

      <div class="toolbar">
        <button class="primary" :disabled="busy" @click="submit">
          {{ busy ? "Saving…" : "Save formula" }}
        </button>
        <button @click="router.push({ name: 'formulas' })">Cancel</button>
      </div>
    </div>

    <div v-if="isEdit" class="panel" style="margin-top: 1rem">
      <h3>Batch calculator</h3>
      <p class="inactive" style="font-size: 0.85rem">
        Enter a batch size to see the required quantity of each raw material (in
        its own stocking unit).
      </p>
      <div v-if="calcError" class="banner error">{{ calcError }}</div>
      <div class="toolbar">
        <input v-model="batchSize" inputmode="decimal" style="max-width: 140px" />
        <select v-model="batchUnit" style="max-width: 120px">
          <option v-for="u in UNITS_OF_MEASURE" :key="u" :value="u">{{ u }}</option>
        </select>
        <button @click="calculate">Calculate</button>
      </div>
      <table v-if="requirements">
        <thead>
          <tr>
            <th>Raw material</th>
            <th class="num">Percent</th>
            <th class="num">Required</th>
            <th>Unit</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="line in requirements.lines" :key="line.rawMaterialId">
            <td>{{ line.name }} <span class="inactive">({{ line.sku }})</span></td>
            <td class="num">{{ line.percentage }}%</td>
            <td class="num">{{ line.requiredQuantity }}</td>
            <td>{{ line.stockingUnit }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
