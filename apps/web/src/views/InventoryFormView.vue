<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  createInventoryItemSchema,
  type IfraCategory,
  IFRA_CATEGORIES,
  type InventoryPosition,
  type InventoryTxn,
  type ItemLocationPosition,
  type ItemQualitySpec,
  ITEM_TYPES,
  type ItemType,
  isStockableKind,
  KG_TO_LB_FORMULA,
  PROP65_STATUSES,
  type Prop65Status,
  type LocatedStockStatus,
  LOCATED_STOCK_STATUSES,
  type Location,
  type LocationMove,
  PERMISSIONS,
  PHYSICAL_FORMS,
  type PhysicalForm,
  QB_ITEM_TYPES,
  type QbItemType,
  QC_SUITE_BY_FORM,
  QC_TEST_KIND,
  QC_TEST_TYPES,
  type QcTestType,
  SCRAP_REASONS,
  type ScrapRecord,
  type StockStatus,
  STOCK_STATUSES,
  UNITS_OF_MEASURE,
  updateInventoryItemSchema,
  type FgRegulatory,
  type Formula,
  type FormulaSummary,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { weightLabel } from "../lib/weight";
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
const route = useRoute();
const isEdit = Boolean(props.id);

// Where to go after save / cancel — callers (e.g. the raw-material list) can pass
// ?return=<routeName> to come back to where they launched the form from.
const returnRoute =
  typeof route.query.return === "string" ? route.query.return : "inventory";
// Optional ?type= preselects the item tier when creating (e.g. RAW_MATERIAL).
const initialType =
  typeof route.query.type === "string" &&
  (ITEM_TYPES as readonly string[]).includes(route.query.type)
    ? (route.query.type as ItemType)
    : "RAW_MATERIAL";

const form = reactive({
  sku: "",
  name: "",
  description: "",
  itemType: initialType,
  physicalForm: "LIQUID" as PhysicalForm,
  unitOfMeasure: "LB",
  salesPrice: "0",
  qbItemType: "INVENTORY" as QbItemType,
  standardCost: "0",
  reorderPoint: "",
  purchaseDescription: "",
  incomeAccount: "",
  cogsAccount: "",
  assetAccount: "",
  active: true,
  // Raw-material regulatory data.
  productionUse: true,
  restrictToFloor: false,
  floorOnlyReason: "",
  casNumber: "",
  flashPointC: "",
  prop65Status: "UNKNOWN" as Prop65Status,
  prop65Notes: "",
});

// Whether the regulatory panel applies (raw materials only).
const isRawMaterial = computed(() => form.itemType === "RAW_MATERIAL");

// --- Finished-good regulatory profile (derived + FormPak+), edit mode only ---
const isFinishedGood = computed(() => form.itemType === "FINISHED_GOOD");
const fgReg = ref<FgRegulatory | null>(null);
const fgRegError = ref<string | null>(null);
const fgRegBusy = ref(false);
const canRefreshFg = auth.hasPermission(PERMISSIONS.INVENTORY_UPDATE);

async function loadFgRegulatory(): Promise<void> {
  if (!props.id || form.itemType !== "FINISHED_GOOD") return;
  fgRegError.value = null;
  try {
    fgReg.value = await api.getFgRegulatory(props.id);
  } catch (err) {
    fgRegError.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}
async function refreshFormPak(): Promise<void> {
  if (!props.id) return;
  fgRegError.value = null;
  fgRegBusy.value = true;
  try {
    fgReg.value = await api.refreshFgRegulatory(props.id);
  } catch (err) {
    fgRegError.value = err instanceof ApiError ? err.message : "Refresh failed";
  } finally {
    fgRegBusy.value = false;
  }
}

// --- Bill of materials (the FG's formula recipe), edit mode only ---
const canReadFormula = auth.hasPermission(PERMISSIONS.FORMULA_READ);
const formulaVersions = ref<FormulaSummary[]>([]);
const selectedFormulaId = ref<string | null>(null);
const bom = ref<Formula | null>(null);
const bomError = ref<string | null>(null);
// Recipe percentages should sum to 100; show the total so a bad formula is obvious.
const bomTotal = computed(() =>
  (bom.value?.lines ?? []).reduce((sum, l) => sum + Number(l.percentage), 0),
);

async function loadBom(): Promise<void> {
  if (!props.id || form.itemType !== "FINISHED_GOOD" || !canReadFormula) return;
  bomError.value = null;
  try {
    formulaVersions.value = await api.listFormulasForItem(props.id);
    // Versions arrive active-first / newest-first, so the first is the default.
    selectedFormulaId.value = formulaVersions.value[0]?.id ?? null;
    await loadBomLines();
  } catch (err) {
    bomError.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

async function loadBomLines(): Promise<void> {
  if (!selectedFormulaId.value) {
    bom.value = null;
    return;
  }
  bomError.value = null;
  try {
    bom.value = await api.getFormula(selectedFormulaId.value);
  } catch (err) {
    bomError.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

// IFRA category usage limits, keyed by category. Empty string = no limit set.
const ifraLimits = reactive<Record<IfraCategory, string>>(
  Object.fromEntries(IFRA_CATEGORIES.map((c) => [c, ""])) as Record<
    IfraCategory,
    string
  >,
);

const PROP65_LABELS: Record<Prop65Status, string> = {
  UNKNOWN: "Unknown / not assessed",
  NOT_LISTED: "No listed chemicals",
  LISTED: "Contains listed chemical(s)",
};

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

// --- Scrap / write-off (edit mode only) ---
const canScrap = auth.hasPermission(PERMISSIONS.STOCK_SCRAP);
const scraps = ref<ScrapRecord[]>([]);
const scrap = reactive({
  status: "INV" as StockStatus,
  locationId: "",
  quantity: "0",
  reason: "DAMAGED" as (typeof SCRAP_REASONS)[number],
  note: "",
});
const scrapError = ref<string | null>(null);
const scrapBusy = ref(false);

// WIP isn't location-tracked; INV/QUARANTINE scrap from a specific location.
const scrapLocated = computed(() => scrap.status !== "WIP");
const scrapSources = computed(() =>
  itemLocations.value.filter((p) => p.status === scrap.status),
);

async function loadLocations(): Promise<void> {
  if (!props.id) return;
  [itemLocations.value, allLocations.value, locationMoves.value, scraps.value] =
    await Promise.all([
      api.itemLocations(props.id),
      api.listLocations(),
      api.itemLocationMoves(props.id),
      api.itemScraps(props.id),
    ]);
}

async function doScrap(): Promise<void> {
  if (!props.id) return;
  scrapError.value = null;
  scrapBusy.value = true;
  try {
    await api.scrapStock(props.id, {
      status: scrap.status,
      quantity: scrap.quantity,
      locationId: scrapLocated.value && scrap.locationId ? scrap.locationId : undefined,
      reason: scrap.reason,
      note: scrap.note || undefined,
    });
    scrap.quantity = "0";
    scrap.note = "";
    await loadStock();
    await loadLocations();
  } catch (err) {
    scrapError.value = err instanceof ApiError ? err.message : "Scrap failed";
  } finally {
    scrapBusy.value = false;
  }
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
      salesPrice: item.salesPrice,
      qbItemType: item.qbItemType,
      standardCost: item.standardCost,
      reorderPoint: item.reorderPoint ?? "",
      purchaseDescription: item.purchaseDescription ?? "",
      incomeAccount: item.incomeAccount ?? "",
      cogsAccount: item.cogsAccount ?? "",
      assetAccount: item.assetAccount ?? "",
      active: item.active,
      productionUse: item.productionUse,
      restrictToFloor: item.restrictToFloor,
      floorOnlyReason: item.floorOnlyReason ?? "",
      casNumber: item.casNumber ?? "",
      flashPointC: item.flashPointC ?? "",
      prop65Status: item.prop65Status,
      prop65Notes: item.prop65Notes ?? "",
    });
    for (const c of IFRA_CATEGORIES) ifraLimits[c] = "";
    for (const l of item.ifraLimits) ifraLimits[l.category] = l.maxPercent;
    await loadStock();
    await loadLocations();
    await loadSpecs();
    await loadFgRegulatory();
    await loadBom();
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : "Failed to load";
  }
});

async function submit(): Promise<void> {
  clearErrors();
  busy.value = true;
  try {
    // Only raw materials carry regulatory data; for other tiers send the
    // defaults so the fields stay clean.
    const ifra = isRawMaterial.value
      ? IFRA_CATEGORIES.filter((c) => ifraLimits[c].trim() !== "").map((c) => ({
          category: c,
          maxPercent: ifraLimits[c].trim(),
        }))
      : [];
    const payload = {
      name: form.name,
      description: form.description || undefined,
      itemType: form.itemType,
      physicalForm: form.physicalForm,
      unitOfMeasure: form.unitOfMeasure,
      salesPrice: form.salesPrice,
      qbItemType: form.qbItemType,
      standardCost: form.standardCost,
      reorderPoint: form.reorderPoint || undefined,
      purchaseDescription: form.purchaseDescription || undefined,
      incomeAccount: form.incomeAccount || undefined,
      cogsAccount: form.cogsAccount || undefined,
      assetAccount: form.assetAccount || undefined,
      active: form.active,
      productionUse: isRawMaterial.value ? form.productionUse : true,
      restrictToFloor: isRawMaterial.value ? form.restrictToFloor : false,
      floorOnlyReason:
        isRawMaterial.value && form.floorOnlyReason ? form.floorOnlyReason : undefined,
      casNumber: isRawMaterial.value && form.casNumber ? form.casNumber : undefined,
      flashPointC:
        isRawMaterial.value && form.flashPointC ? form.flashPointC : undefined,
      prop65Status: isRawMaterial.value ? form.prop65Status : "UNKNOWN",
      prop65Notes:
        isRawMaterial.value && form.prop65Notes ? form.prop65Notes : undefined,
      ifraLimits: ifra,
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
    await router.push({ name: returnRoute });
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
          <label for="uom">Handling unit</label>
          <select id="uom" v-model="form.unitOfMeasure">
            <option v-for="u in UNITS_OF_MEASURE" :key="u" :value="u">{{ u }}</option>
          </select>
          <div class="inactive" style="font-size: 0.8rem">
            Inventory is stored in pounds.
            <template v-if="form.unitOfMeasure === 'KG'"> KG materials are received in kg and converted: {{ KG_TO_LB_FORMULA }}.</template>
          </div>
          <div v-if="errors.unitOfMeasure" class="error">{{ errors.unitOfMeasure }}</div>
        </div>
        <div class="field">
          <label for="price">Sales price</label>
          <input id="price" v-model="form.salesPrice" inputmode="decimal" />
          <div v-if="errors.salesPrice" class="error">{{ errors.salesPrice }}</div>
        </div>
      </div>

      <p class="inactive" style="font-size: 0.8rem">
        This is the item master. Quantity on hand and average cost are derived
        from transactions (the stock ledger), not set here.
        <template v-if="isEdit">Use “Adjust inventory” below to post an opening balance or correction.</template>
        <template v-else>After saving, open the item to post an opening balance via an inventory adjustment.</template>
      </p>

      <h4>QuickBooks / accounting</h4>
      <div class="grid-2">
        <div class="field">
          <label for="qbtype">QuickBooks item type</label>
          <select id="qbtype" v-model="form.qbItemType">
            <option v-for="t in QB_ITEM_TYPES" :key="t" :value="t">{{ t.replace(/_/g, " ") }}</option>
          </select>
        </div>
        <div class="field">
          <label>Standard / purchase cost</label>
          <input v-model="form.standardCost" inputmode="decimal" />
        </div>
        <div class="field">
          <label>Reorder point</label>
          <input v-model="form.reorderPoint" inputmode="decimal" placeholder="none" />
          <small class="inactive">
            Below this usable on-hand, {{ isRawMaterial ? "Purchasing" : "Scheduling" }} is flagged.
          </small>
        </div>
        <div class="field">
          <label>Income account</label>
          <input v-model="form.incomeAccount" placeholder="e.g. Sales:Fragrance" />
        </div>
        <div class="field">
          <label>COGS account</label>
          <input v-model="form.cogsAccount" placeholder="e.g. Cost of Goods Sold" />
        </div>
        <div class="field">
          <label>Inventory asset account</label>
          <input v-model="form.assetAccount" placeholder="e.g. Inventory Asset" />
        </div>
        <div class="field">
          <label>Purchase description</label>
          <input v-model="form.purchaseDescription" />
        </div>
      </div>

      <template v-if="isRawMaterial">
        <h4>Regulatory</h4>
        <div class="field">
          <label>
            <input type="checkbox" v-model="form.productionUse" style="width: auto" />
            Used in production
          </label>
          <div class="inactive" style="font-size: 0.8rem">
            Uncheck for R&amp;D / lab-only materials. Unchecked materials stay in
            inventory but are hidden from the production compounder dosing tool.
          </div>
        </div>
        <div class="field">
          <label>
            <input type="checkbox" v-model="form.restrictToFloor" style="width: auto" />
            Floor-only (never robot / 2lb lab)
          </label>
          <div class="inactive" style="font-size: 0.8rem">
            For resins, materials needing heating, must-add-last, or reaction-prone
            materials. Their pours are always assigned to the floor.
          </div>
        </div>
        <div v-if="form.restrictToFloor" class="field">
          <label>Floor-only reason (optional)</label>
          <input v-model="form.floorOnlyReason" placeholder="e.g. resin — must be heated" />
        </div>
        <div class="grid-2">
          <div class="field">
            <label>CAS number</label>
            <input v-model="form.casNumber" placeholder="e.g. 3738-00-9" />
            <div v-if="errors.casNumber" class="error">{{ errors.casNumber }}</div>
          </div>
          <div class="field">
            <label>Flash point (°C)</label>
            <input v-model="form.flashPointC" inputmode="decimal" placeholder="closed cup" />
            <div v-if="errors.flashPointC" class="error">{{ errors.flashPointC }}</div>
          </div>
          <div class="field">
            <label>Prop 65 status</label>
            <select v-model="form.prop65Status">
              <option v-for="s in PROP65_STATUSES" :key="s" :value="s">
                {{ PROP65_LABELS[s] }}
              </option>
            </select>
          </div>
          <div class="field">
            <label>Prop 65 notes</label>
            <input v-model="form.prop65Notes" placeholder="listed chemical(s)" />
          </div>
        </div>

        <div class="field">
          <label>IFRA usage limits (max % in finished product)</label>
          <div class="inactive" style="font-size: 0.8rem; margin-bottom: 0.4rem">
            Leave a category blank if there is no restriction (49th Amendment categories).
          </div>
          <div class="ifra-grid">
            <label v-for="c in IFRA_CATEGORIES" :key="c" class="ifra-cell">
              <span class="ifra-cat">Cat {{ c }}</span>
              <input
                v-model="ifraLimits[c]"
                inputmode="decimal"
                placeholder="—"
              />
            </label>
          </div>
        </div>
      </template>

      <div class="field">
        <label><input type="checkbox" v-model="form.active" style="width: auto" /> Active</label>
      </div>

      <div class="toolbar">
        <button class="primary" :disabled="busy" @click="submit">
          {{ busy ? "Saving…" : "Save" }}
        </button>
        <button @click="router.push({ name: returnRoute })">Cancel</button>
      </div>
    </div>

    <div v-if="isEdit" class="panel" style="margin-top: 1rem">
      <h3>Inventory position</h3>
      <div v-if="position" class="summary" style="margin-bottom: 1rem">
        <div class="metric">
          <div class="label">On hand</div>
          <div class="value">{{ weightLabel(position.quantityOnHand, position.unitOfMeasure) }}</div>
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
        <h4>Adjust inventory</h4>
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
            <th>Lot</th>
            <th>Operator</th>
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
            <td>{{ t.lotNumber ?? "—" }}</td>
            <td>{{ t.createdByName ?? "—" }}</td>
            <td>{{ t.note }}</td>
          </tr>
          <tr v-if="ledger.length === 0">
            <td colspan="9" class="inactive">
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
            <td>
              <span style="font-variant-numeric: tabular-nums">{{ p.locationCode }}</span>
              <span class="inactive"> {{ p.locationName }}</span>
            </td>
            <td class="num">{{ p.quantity }}</td>
          </tr>
          <tr v-if="itemLocations.length === 0">
            <td colspan="3" class="inactive">No located inventory.</td>
          </tr>
        </tbody>
      </table>

      <div v-if="canMove" style="margin-top: 1rem">
        <h4>Move inventory between locations</h4>
        <div v-if="moveError" class="banner error">{{ moveError }}</div>
        <div class="toolbar">
          <select v-model="move.status" style="max-width: 130px">
            <option v-for="s in LOCATED_STOCK_STATUSES" :key="s" :value="s">{{ s }}</option>
          </select>
          <select v-model="move.fromLocationId" style="max-width: 220px">
            <option value="">From…</option>
            <option v-for="p in moveSources" :key="p.locationId" :value="p.locationId">
              {{ p.locationCode }} — {{ p.locationName }} ({{ p.quantity }})
            </option>
          </select>
          <select v-model="move.toLocationId" style="max-width: 220px">
            <option value="">To…</option>
            <option
              v-for="l in allLocations.filter((l) => l.active && isStockableKind(l.kind) && l.id !== move.fromLocationId)"
              :key="l.id"
              :value="l.id"
            >
              {{ l.code }} — {{ l.name }}
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

    <div v-if="isEdit && (canScrap || scraps.length)" class="panel" style="margin-top: 1rem">
      <h3>Scrap (write-off)</h3>
      <p class="inactive" style="font-size: 0.85rem">
        Write off unusable inventory from any stage — INV (usable), WIP, or
        quarantine. Posts a loss at the item's average cost and records the reason.
      </p>
      <div v-if="canScrap">
        <div v-if="scrapError" class="banner error">{{ scrapError }}</div>
        <div class="toolbar" style="flex-wrap: wrap">
          <select v-model="scrap.status" style="max-width: 130px">
            <option v-for="s in STOCK_STATUSES" :key="s" :value="s">{{ s }}</option>
          </select>
          <select v-if="scrapLocated" v-model="scrap.locationId" style="max-width: 240px">
            <option value="">From… (location)</option>
            <option v-for="p in scrapSources" :key="p.locationId" :value="p.locationId">
              {{ p.locationCode }} — {{ p.locationName }} ({{ p.quantity }})
            </option>
          </select>
          <input v-model="scrap.quantity" inputmode="decimal" placeholder="Qty (lb)" style="max-width: 100px" />
          <select v-model="scrap.reason" style="max-width: 160px">
            <option v-for="r in SCRAP_REASONS" :key="r" :value="r">{{ r }}</option>
          </select>
          <input v-model="scrap.note" placeholder="Note (optional)" />
          <button
            class="danger"
            :disabled="scrapBusy || Number(scrap.quantity) <= 0"
            @click="doScrap"
          >
            {{ scrapBusy ? "Scrapping…" : "Scrap" }}
          </button>
        </div>
      </div>

      <template v-if="scraps.length">
        <h4>Scrap history</h4>
        <table>
          <thead>
            <tr>
              <th>When</th><th>Stage</th><th>Location</th>
              <th class="num">Qty</th><th class="num">Value</th>
              <th>Reason</th><th>By</th><th>Note</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in scraps" :key="s.id">
              <td>{{ new Date(s.occurredAt).toLocaleString() }}</td>
              <td>{{ s.status }}</td>
              <td>{{ s.locationCode ?? "—" }}</td>
              <td class="num">{{ s.quantity }}</td>
              <td class="num">${{ s.value }}</td>
              <td>{{ s.reason }}</td>
              <td>{{ s.operatorName }}</td>
              <td>{{ s.note }}</td>
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

    <div
      v-if="isEdit && isFinishedGood && canReadFormula"
      class="panel"
      style="margin-top: 1rem"
    >
      <div class="toolbar">
        <h3 style="margin: 0">Bill of materials</h3>
        <span class="spacer" />
        <label v-if="formulaVersions.length" style="font-size: 0.85rem">
          Version:
          <select v-model="selectedFormulaId" @change="loadBomLines">
            <option v-for="v in formulaVersions" :key="v.id" :value="v.id">
              v{{ v.version }}{{ v.isActive ? " (active)" : "" }}
            </option>
          </select>
        </label>
        <router-link
          v-if="selectedFormulaId"
          :to="{ name: 'formula-edit', params: { id: selectedFormulaId } }"
        >
          Open formula
        </router-link>
      </div>
      <div v-if="bomError" class="banner error">{{ bomError }}</div>

      <p v-if="!formulaVersions.length" class="inactive" style="font-size: 0.85rem">
        No formula defined for this finished good.
      </p>
      <template v-else-if="bom">
        <p class="inactive" style="font-size: 0.85rem">
          <strong>{{ bom.name }}</strong> (v{{ bom.version }})<span v-if="bom.notes">
            — {{ bom.notes }}</span
          >
        </p>
        <table>
          <thead>
            <tr><th>Component</th><th class="num">%</th></tr>
          </thead>
          <tbody>
            <tr v-for="line in bom.lines" :key="line.id">
              <td>
                {{ line.rawMaterialName }}
                <span class="inactive">({{ line.rawMaterialSku }})</span>
              </td>
              <td class="num">{{ line.percentage }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td class="num" :class="{ warn: Math.abs(bomTotal - 100) > 0.0001 }">
                {{ bomTotal.toFixed(4) }}
              </td>
            </tr>
          </tfoot>
        </table>
      </template>
    </div>

    <div v-if="isEdit && isFinishedGood" class="panel" style="margin-top: 1rem">
      <div class="toolbar">
        <h3 style="margin: 0">Regulatory</h3>
        <span class="spacer" />
        <button v-if="canRefreshFg" :disabled="fgRegBusy" @click="refreshFormPak">
          {{ fgRegBusy ? "Refreshing…" : "Refresh from FormPak+" }}
        </button>
      </div>
      <div v-if="fgRegError" class="banner error">{{ fgRegError }}</div>

      <template v-if="fgReg">
        <p class="inactive" style="font-size: 0.85rem">
          Derived from the raw-material make-up of
          <template v-if="fgReg.derived.hasFormula">
            <strong>{{ fgReg.derived.formulaName }}</strong> (v{{ fgReg.derived.formulaVersion }})
          </template>
          <template v-else>— no active formula —</template>.
          FormPak+ values are the authoritative finished-product data.
        </p>

        <h4>Derived from raw materials</h4>
        <div class="summary" style="margin-bottom: 0.5rem">
          <div class="metric">
            <div class="label">Prop 65</div>
            <div class="value" style="font-size: 1rem" :class="{ warn: fgReg.derived.prop65Status === 'LISTED' }">
              {{ fgReg.derived.prop65Status }}
            </div>
          </div>
          <div class="metric">
            <div class="label">Components</div>
            <div class="value" style="font-size: 1rem">{{ fgReg.derived.components.length }}</div>
          </div>
        </div>
        <p v-if="fgReg.derived.prop65Contributors.length" class="inactive" style="font-size: 0.8rem">
          Prop 65 via:
          {{ fgReg.derived.prop65Contributors.map((c) => c.sku).join(", ") }}
        </p>

        <table v-if="fgReg.derived.components.length">
          <thead>
            <tr><th>Component</th><th>CAS #</th><th class="num">Effective %</th></tr>
          </thead>
          <tbody>
            <tr v-for="c in fgReg.derived.components" :key="c.itemId">
              <td>{{ c.name }} <span class="inactive">({{ c.sku }})</span></td>
              <td>{{ c.casNumber ?? "—" }}</td>
              <td class="num">{{ c.effectivePercent }}</td>
            </tr>
          </tbody>
        </table>

        <template v-if="fgReg.derived.ifraDerived.length">
          <h4>IFRA — derived max in finished product (indicative)</h4>
          <table>
            <thead>
              <tr><th>Category</th><th class="num">Max %</th><th>Limited by</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in fgReg.derived.ifraDerived" :key="r.category">
                <td>Cat {{ r.category }}</td>
                <td class="num">{{ r.maxPercent }}</td>
                <td class="inactive">{{ r.limitingSku }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <h4 style="margin-top: 1rem">FormPak+</h4>
        <template v-if="fgReg.formPak">
          <div class="summary" style="margin-bottom: 0.5rem">
            <div class="metric">
              <div class="label">Compliance</div>
              <div class="value" style="font-size: 1rem" :class="{ warn: fgReg.formPak.complianceStatus === 'NON_COMPLIANT' }">
                {{ fgReg.formPak.complianceStatus }}
              </div>
            </div>
            <div class="metric">
              <div class="label">Flash point</div>
              <div class="value" style="font-size: 1rem">
                {{ fgReg.formPak.flashPointC ?? "—" }}<span v-if="fgReg.formPak.flashPointC">°C</span>
              </div>
            </div>
          </div>
          <p v-if="fgReg.formPak.allergenDeclaration" style="font-size: 0.85rem">
            {{ fgReg.formPak.allergenDeclaration }}
          </p>
          <table v-if="fgReg.formPak.ifraLevels.length">
            <thead>
              <tr><th>IFRA category</th><th class="num">QRA max %</th></tr>
            </thead>
            <tbody>
              <tr v-for="l in fgReg.formPak.ifraLevels" :key="l.category">
                <td>Cat {{ l.category }}</td>
                <td class="num">{{ l.maxPercent }}</td>
              </tr>
            </tbody>
          </table>
          <p class="inactive" style="font-size: 0.8rem; margin-top: 0.5rem">
            <a v-if="fgReg.formPak.certificateUrl" :href="fgReg.formPak.certificateUrl" target="_blank">Certificate</a>
            <span v-if="fgReg.formPak.certificateUrl"> · </span>
            <span v-if="fgReg.formPak.syncedAt">
              Synced {{ new Date(fgReg.formPak.syncedAt).toLocaleString() }}
            </span>
          </p>
        </template>
        <p v-else class="inactive" style="font-size: 0.85rem">
          Not yet synced from FormPak+. Use “Refresh from FormPak+” to pull flash
          point, IFRA QRA levels, allergen declaration, and compliance.
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.warn {
  color: #b45309;
  font-weight: 600;
}
.ifra-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 0.5rem;
}
.ifra-cell {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.ifra-cat {
  font-size: 0.8rem;
  min-width: 3.2rem;
}
.ifra-cell input {
  max-width: 70px;
  text-align: right;
}
</style>
