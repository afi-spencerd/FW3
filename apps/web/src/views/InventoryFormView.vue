<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  createInventoryItemSchema,
  type InventoryPosition,
  type InventoryTxn,
  type ItemQualitySpec,
  ITEM_TYPES,
  type ItemType,
  PERMISSIONS,
  QC_TEST_KIND,
  QC_TEST_TYPES,
  type QcTestType,
  UNITS_OF_MEASURE,
  updateInventoryItemSchema,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();

const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  RAW_MATERIAL: "Raw material",
  SEMI_FINISHED: "Base",
  FINISHED_GOOD: "Finished good",
};

const props = defineProps<{ id?: string }>();
const router = useRouter();
const isEdit = Boolean(props.id);

const form = reactive({
  sku: "",
  name: "",
  description: "",
  itemType: "RAW_MATERIAL" as ItemType,
  unitOfMeasure: "LB",
  quantityOnHand: "0",
  unitCost: "0",
  salesPrice: "0",
  active: true,
});

const errors = reactive<Record<string, string>>({});
const formError = ref<string | null>(null);
const busy = ref(false);

// --- Stock position + ledger (edit mode only) ---
const position = ref<InventoryPosition | null>(null);
const ledger = ref<InventoryTxn[]>([]);
const adjust = reactive({
  direction: "IN" as "IN" | "OUT",
  quantity: "0",
  unitCost: "0",
  note: "",
});
const adjustError = ref<string | null>(null);
const adjustBusy = ref(false);

async function loadStock(): Promise<void> {
  if (!props.id) return;
  [position.value, ledger.value] = await Promise.all([
    api.itemPosition(props.id),
    api.itemLedger(props.id),
  ]);
}

async function doAdjust(): Promise<void> {
  if (!props.id) return;
  adjustError.value = null;
  adjustBusy.value = true;
  try {
    await api.adjustStock(props.id, {
      direction: adjust.direction,
      quantity: adjust.quantity,
      unitCost: adjust.direction === "IN" ? adjust.unitCost : undefined,
      note: adjust.note || undefined,
    });
    adjust.quantity = "0";
    adjust.note = "";
    await loadStock();
  } catch (err) {
    adjustError.value =
      err instanceof ApiError ? err.message : "Adjustment failed";
  } finally {
    adjustBusy.value = false;
  }
}

function setIssues(issues: { path: string; message: string }[]): void {
  for (const issue of issues) errors[issue.path] = issue.message;
}

function clearErrors(): void {
  for (const key of Object.keys(errors)) delete errors[key];
  formError.value = null;
}

// --- QC acceptance spec (edit mode only) ---
const QC_TEST_LABELS: Record<QcTestType, string> = {
  SPECIFIC_GRAVITY: "Specific gravity",
  REFRACTIVE_INDEX: "Refractive index",
  COLOR: "Color",
  ODOR: "Odor",
};
const specForm = reactive(
  Object.fromEntries(
    QC_TEST_TYPES.map((t) => [t, { minValue: "", maxValue: "", expectedValue: "" }]),
  ) as Record<QcTestType, { minValue: string; maxValue: string; expectedValue: string }>,
);
const specNotice = ref<string | null>(null);
const specBusy = ref(false);
const canManageSpec = auth.hasPermission(PERMISSIONS.QC_SPEC_MANAGE);
const QC_KIND = QC_TEST_KIND;

function applySpecs(specs: ItemQualitySpec[]): void {
  for (const s of specs) {
    specForm[s.testType] = {
      minValue: s.minValue ?? "",
      maxValue: s.maxValue ?? "",
      expectedValue: s.expectedValue ?? "",
    };
  }
}
async function loadSpecs(): Promise<void> {
  if (!props.id) return;
  applySpecs(await api.getItemQualitySpec(props.id));
}
async function saveSpecs(): Promise<void> {
  if (!props.id) return;
  specBusy.value = true;
  specNotice.value = null;
  try {
    const specs = QC_TEST_TYPES.map((testType) => ({
      testType,
      minValue: specForm[testType].minValue || undefined,
      maxValue: specForm[testType].maxValue || undefined,
      expectedValue: specForm[testType].expectedValue || undefined,
    }));
    applySpecs(await api.setItemQualitySpec(props.id, { specs }));
    specNotice.value = "QC spec saved.";
  } catch (err) {
    specNotice.value = err instanceof ApiError ? err.message : "Save failed";
  } finally {
    specBusy.value = false;
  }
}

onMounted(async () => {
  if (!props.id) return;
  try {
    const item = await api.getInventory(props.id);
    Object.assign(form, {
      sku: item.sku,
      name: item.name,
      description: item.description ?? "",
      itemType: item.itemType,
      unitOfMeasure: item.unitOfMeasure,
      quantityOnHand: item.quantityOnHand,
      unitCost: item.unitCost,
      salesPrice: item.salesPrice,
      active: item.active,
    });
    await loadStock();
    await loadSpecs();
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : "Failed to load";
  }
});

async function submit(): Promise<void> {
  clearErrors();
  busy.value = true;
  try {
    const payload = {
      name: form.name,
      description: form.description || undefined,
      itemType: form.itemType,
      unitOfMeasure: form.unitOfMeasure,
      quantityOnHand: form.quantityOnHand,
      unitCost: form.unitCost,
      salesPrice: form.salesPrice,
      active: form.active,
    };

    if (isEdit && props.id) {
      // UX-level validation against the shared schema before hitting the API.
      const parsed = updateInventoryItemSchema.safeParse(payload);
      if (!parsed.success) {
        setIssues(
          parsed.error.issues.map((i) => ({
            path: String(i.path[0] ?? ""),
            message: i.message,
          })),
        );
        return;
      }
      await api.updateInventory(props.id, parsed.data);
    } else {
      const parsed = createInventoryItemSchema.safeParse({
        ...payload,
        sku: form.sku,
      });
      if (!parsed.success) {
        setIssues(
          parsed.error.issues.map((i) => ({
            path: String(i.path[0] ?? ""),
            message: i.message,
          })),
        );
        return;
      }
      await api.createInventory(parsed.data);
    }
    await router.push({ name: "inventory" });
  } catch (err) {
    if (err instanceof ApiError) {
      formError.value = err.message;
      if (err.issues) setIssues(err.issues);
    } else {
      formError.value = "Save failed";
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="container" style="max-width: 640px">
    <div class="panel">
      <h2>{{ isEdit ? "Edit item" : "New item" }}</h2>
      <div v-if="formError" class="banner error">{{ formError }}</div>

      <div class="field">
        <label for="sku">SKU</label>
        <input id="sku" v-model="form.sku" :disabled="isEdit" />
        <div v-if="errors.sku" class="error">{{ errors.sku }}</div>
      </div>

      <div class="field">
        <label for="name">Name</label>
        <input id="name" v-model="form.name" />
        <div v-if="errors.name" class="error">{{ errors.name }}</div>
      </div>

      <div class="field">
        <label for="description">Description</label>
        <input id="description" v-model="form.description" />
        <div v-if="errors.description" class="error">{{ errors.description }}</div>
      </div>

      <div class="field">
        <label for="itemType">Item type</label>
        <select id="itemType" v-model="form.itemType">
          <option v-for="t in ITEM_TYPES" :key="t" :value="t">
            {{ ITEM_TYPE_LABELS[t] }}
          </option>
        </select>
        <div v-if="errors.itemType" class="error">{{ errors.itemType }}</div>
      </div>

      <div class="grid-2">
        <div class="field">
          <label for="uom">Unit of measure</label>
          <select id="uom" v-model="form.unitOfMeasure">
            <option v-for="u in UNITS_OF_MEASURE" :key="u" :value="u">{{ u }}</option>
          </select>
          <div v-if="errors.unitOfMeasure" class="error">{{ errors.unitOfMeasure }}</div>
        </div>
        <div class="field">
          <label for="qty">Quantity on hand</label>
          <input id="qty" v-model="form.quantityOnHand" inputmode="decimal" />
          <div v-if="errors.quantityOnHand" class="error">{{ errors.quantityOnHand }}</div>
        </div>
        <div class="field">
          <label for="cost">Unit cost</label>
          <input id="cost" v-model="form.unitCost" inputmode="decimal" />
          <div v-if="errors.unitCost" class="error">{{ errors.unitCost }}</div>
        </div>
        <div class="field">
          <label for="price">Sales price</label>
          <input id="price" v-model="form.salesPrice" inputmode="decimal" />
          <div v-if="errors.salesPrice" class="error">{{ errors.salesPrice }}</div>
        </div>
      </div>

      <div class="field">
        <label><input type="checkbox" v-model="form.active" style="width: auto" /> Active</label>
      </div>

      <div class="toolbar">
        <button class="primary" :disabled="busy" @click="submit">
          {{ busy ? "Saving…" : "Save" }}
        </button>
        <button @click="router.push({ name: 'inventory' })">Cancel</button>
      </div>
    </div>

    <div v-if="isEdit" class="panel" style="margin-top: 1rem">
      <h3>Stock position</h3>
      <div v-if="position" class="summary" style="margin-bottom: 1rem">
        <div class="metric">
          <div class="label">On hand</div>
          <div class="value">{{ position.quantityOnHand }} {{ position.unitOfMeasure }}</div>
        </div>
        <div class="metric">
          <div class="label">Avg cost</div>
          <div class="value">${{ position.avgCost }}</div>
        </div>
        <div class="metric">
          <div class="label">Total value</div>
          <div class="value">${{ position.totalValue }}</div>
        </div>
      </div>

      <div v-if="auth.hasPermission(PERMISSIONS.STOCK_ADJUST)">
        <h4>Adjust stock</h4>
        <div v-if="adjustError" class="banner error">{{ adjustError }}</div>
        <div class="toolbar">
          <select v-model="adjust.direction" style="max-width: 110px">
            <option value="IN">In</option>
            <option value="OUT">Out</option>
          </select>
          <input v-model="adjust.quantity" inputmode="decimal" placeholder="Qty" style="max-width: 120px" />
          <input
            v-if="adjust.direction === 'IN'"
            v-model="adjust.unitCost"
            inputmode="decimal"
            placeholder="Unit cost"
            style="max-width: 120px"
          />
          <input v-model="adjust.note" placeholder="Note (optional)" />
          <button :disabled="adjustBusy" @click="doAdjust">
            {{ adjustBusy ? "Posting…" : "Post" }}
          </button>
        </div>
      </div>

      <h4>Ledger</h4>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Type</th>
            <th class="num">Qty</th>
            <th class="num">Unit cost</th>
            <th class="num">Value</th>
            <th class="num">Balance</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in ledger" :key="t.id">
            <td>{{ new Date(t.occurredAt).toLocaleString() }}</td>
            <td>{{ t.type }}</td>
            <td class="num">{{ t.quantity }}</td>
            <td class="num">{{ t.unitCost }}</td>
            <td class="num">{{ t.value }}</td>
            <td class="num">{{ t.balanceQty }}</td>
            <td>{{ t.note }}</td>
          </tr>
          <tr v-if="ledger.length === 0">
            <td colspan="7" class="inactive">
              No ledger entries yet (the on-hand above is the opening balance).
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="isEdit" class="panel" style="margin-top: 1rem">
      <h3>QC acceptance spec</h3>
      <p class="inactive" style="font-size: 0.85rem">
        Used to auto-evaluate received lots. Numeric tests use a min/max range;
        descriptive tests match an expected value.
      </p>
      <div v-if="specNotice" class="banner ok">{{ specNotice }}</div>
      <table>
        <thead>
          <tr><th>Test</th><th>Min</th><th>Max</th><th>Expected</th></tr>
        </thead>
        <tbody>
          <tr v-for="t in QC_TEST_TYPES" :key="t">
            <td>{{ QC_TEST_LABELS[t] }}</td>
            <td>
              <input
                v-if="QC_KIND[t] === 'NUMERIC'"
                v-model="specForm[t].minValue"
                inputmode="decimal"
                :disabled="!canManageSpec"
                style="max-width: 110px"
              />
              <span v-else class="inactive">—</span>
            </td>
            <td>
              <input
                v-if="QC_KIND[t] === 'NUMERIC'"
                v-model="specForm[t].maxValue"
                inputmode="decimal"
                :disabled="!canManageSpec"
                style="max-width: 110px"
              />
              <span v-else class="inactive">—</span>
            </td>
            <td>
              <input
                v-if="QC_KIND[t] === 'DESCRIPTIVE'"
                v-model="specForm[t].expectedValue"
                :disabled="!canManageSpec"
                style="max-width: 160px"
              />
              <span v-else class="inactive">—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="canManageSpec" class="toolbar">
        <button class="primary" :disabled="specBusy" @click="saveSpecs">
          {{ specBusy ? "Saving…" : "Save QC spec" }}
        </button>
      </div>
    </div>
  </div>
</template>
