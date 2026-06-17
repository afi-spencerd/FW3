<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  createInventoryItemSchema,
  type InventoryPosition,
  type InventoryTxn,
  type ItemLocationPosition,
  type ItemQualitySpec,
  ITEM_TYPES,
  type ItemType,
  type LocatedStockStatus,
  LOCATED_STOCK_STATUSES,
  type Location,
  type LocationMove,
  PERMISSIONS,
  PHYSICAL_FORMS,
  type PhysicalForm,
  QC_SUITE_BY_FORM,
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

const PHYSICAL_FORM_LABELS: Record<PhysicalForm, string> = {
  LIQUID: "Liquid",
  SOLID: "Solid (crystal)",
};

const props = defineProps<{ id?: string }>();
const router = useRouter();
const isEdit = Boolean(props.id);

const form = reactive({
  sku: "",
  name: "",
  description: "",
  itemType: "RAW_MATERIAL" as ItemType,
  physicalForm: "LIQUID" as PhysicalForm,
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

// --- Physical locations (edit mode only) ---
const itemLocations = ref<ItemLocationPosition[]>([]);
const allLocations = ref<Location[]>([]);
const locationMoves = ref<LocationMove[]>([]);
const canMove = auth.hasPermission(PERMISSIONS.STOCK_MOVE);
const move = reactive({
  status: "INV" as LocatedStockStatus,
  fromLocationId: "",
  toLocationId: "",
  quantity: "0",
  note: "",
});
const moveError = ref<string | null>(null);
const moveBusy = ref(false);

// Locations the item actually has stock in, for the chosen status (move source).
const moveSources = computed(() =>
  itemLocations.value.filter((p) => p.status === move.status),
);

async function loadLocations(): Promise<void> {
  if (!props.id) return;
  [itemLocations.value, allLocations.value, locationMoves.value] =
    await Promise.all([
      api.itemLocations(props.id),
      api.listLocations(),
      api.itemLocationMoves(props.id),
    ]);
}

async function doMove(): Promise<void> {
  if (!props.id) return;
  moveError.value = null;
  moveBusy.value = true;
  try {
    await api.moveStock(props.id, {
      status: move.status,
      fromLocationId: move.fromLocationId,
      toLocationId: move.toLocationId,
      quantity: move.quantity,
      note: move.note || undefined,
    });
    move.quantity = "0";
    move.note = "";
    await loadLocations();
  } catch (err) {
    moveError.value = err instanceof ApiError ? err.message : "Move failed";
  } finally {
    moveBusy.value = false;
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
  GARDNER_COLOR: "Gardner color (1–18)",
  ODOR: "Odor",
  APPEARANCE: "Appearance",
  MELTING_POINT: "Melting point (°C)",
};
const specForm = reactive(
  Object.fromEntries(
    QC_TEST_TYPES.map((t) => [t, { minValue: "", maxValue: "", expectedValue: "" }]),
  ) as Record<QcTestType, { minValue: string; maxValue: string; expectedValue: string }>,
);
// The acceptance suite is driven by the item's physical form.
const specSuite = computed(() => QC_SUITE_BY_FORM[form.physicalForm]);
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
    const specs = specSuite.value.map((testType) => ({
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
      physicalForm: item.physicalForm,
      unitOfMeasure: item.unitOfMeasure,
      quantityOnHand: item.quantityOnHand,
      unitCost: item.unitCost,
      salesPrice: item.salesPrice,
      active: item.active,
    });
    await loadStock();
    await loadLocations();
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
      physicalForm: form.physicalForm,
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

      <div class="field">
        <label for="physicalForm">Physical form</label>
        <select id="physicalForm" v-model="form.physicalForm">
          <option v-for="f in PHYSICAL_FORMS" :key="f" :value="f">
            {{ PHYSICAL_FORM_LABELS[f] }}
          </option>
        </select>
        <div class="inactive" style="font-size: 0.8rem">
          Drives the QC acceptance suite (liquids vs. crystalline solids).
        </div>
        <div v-if="errors.physicalForm" class="error">{{ errors.physicalForm }}</div>
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
      <h3>Physical locations</h3>
      <p class="inactive" style="font-size: 0.85rem">
        Where this item physically sits. Cost is item-level; moving between
        locations shifts quantity only.
      </p>
      <table>
        <thead>
          <tr><th>Status</th><th>Location</th><th class="num">Quantity</th></tr>
        </thead>
        <tbody>
          <tr v-for="p in itemLocations" :key="p.status + p.locationId">
            <td>{{ p.status }}</td>
            <td>{{ p.locationName }}<span v-if="p.locationCode" class="inactive"> ({{ p.locationCode }})</span></td>
            <td class="num">{{ p.quantity }}</td>
          </tr>
          <tr v-if="itemLocations.length === 0">
            <td colspan="3" class="inactive">No located stock.</td>
          </tr>
        </tbody>
      </table>

      <div v-if="canMove" style="margin-top: 1rem">
        <h4>Move stock between locations</h4>
        <div v-if="moveError" class="banner error">{{ moveError }}</div>
        <div class="toolbar">
          <select v-model="move.status" style="max-width: 130px">
            <option v-for="s in LOCATED_STOCK_STATUSES" :key="s" :value="s">{{ s }}</option>
          </select>
          <select v-model="move.fromLocationId" style="max-width: 200px">
            <option value="">From…</option>
            <option v-for="p in moveSources" :key="p.locationId" :value="p.locationId">
              {{ p.locationName }} ({{ p.quantity }})
            </option>
          </select>
          <select v-model="move.toLocationId" style="max-width: 200px">
            <option value="">To…</option>
            <option
              v-for="l in allLocations.filter((l) => l.active && l.id !== move.fromLocationId)"
              :key="l.id"
              :value="l.id"
            >
              {{ l.name }}
            </option>
          </select>
          <input v-model="move.quantity" inputmode="decimal" placeholder="Qty" style="max-width: 100px" />
          <input v-model="move.note" placeholder="Note (optional)" />
          <button
            :disabled="moveBusy || !move.fromLocationId || !move.toLocationId"
            @click="doMove"
          >
            {{ moveBusy ? "Moving…" : "Move" }}
          </button>
        </div>
      </div>

      <template v-if="locationMoves.length">
        <h4>Recent moves</h4>
        <table>
          <thead>
            <tr><th>When</th><th>Status</th><th>From</th><th>To</th><th class="num">Qty</th><th>Note</th></tr>
          </thead>
          <tbody>
            <tr v-for="m in locationMoves" :key="m.id">
              <td>{{ new Date(m.occurredAt).toLocaleString() }}</td>
              <td>{{ m.status }}</td>
              <td>{{ m.fromLocationName ?? "—" }}</td>
              <td>{{ m.toLocationName ?? "—" }}</td>
              <td class="num">{{ m.quantity }}</td>
              <td>{{ m.note }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>

    <div v-if="isEdit" class="panel" style="margin-top: 1rem">
      <h3>QC acceptance spec</h3>
      <p class="inactive" style="font-size: 0.85rem">
        Suite is set by the item's physical form. Numeric tests (e.g. specific
        gravity, Gardner color, melting point) auto-evaluate against a min/max
        range; judgment tests (odor, appearance) are passed/failed by the
        analyst, with an optional reference description.
      </p>
      <div v-if="specNotice" class="banner ok">{{ specNotice }}</div>
      <table>
        <thead>
          <tr><th>Test</th><th>Min</th><th>Max</th><th>Reference</th></tr>
        </thead>
        <tbody>
          <tr v-for="t in specSuite" :key="t">
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
                v-if="QC_KIND[t] === 'JUDGMENT'"
                v-model="specForm[t].expectedValue"
                :disabled="!canManageSpec"
                placeholder="e.g. white crystalline powder"
                style="max-width: 200px"
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
