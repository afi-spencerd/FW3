<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  CONTAINER_TYPES,
  type ContainerType,
  createContainerSchema,
  ITEM_TYPES,
  type ItemType,
  openingStockSchema,
  PHYSICAL_FORMS,
  type PhysicalForm,
  UNITS_OF_MEASURE,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";

const router = useRouter();

const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  RAW_MATERIAL: "Raw material",
  SEMI_FINISHED: "Base",
  FINISHED_GOOD: "Finished good",
};
const PHYSICAL_FORM_LABELS: Record<PhysicalForm, string> = {
  LIQUID: "Liquid",
  SOLID: "Solid (crystal)",
};

// One screen for all opening stock: inventory items and containers.
const kind = ref<"ITEM" | "CONTAINER">("ITEM");

const form = reactive({
  sku: "",
  name: "",
  // Item-specific
  itemType: "RAW_MATERIAL" as ItemType,
  physicalForm: "LIQUID" as PhysicalForm,
  unitOfMeasure: "LB",
  // Container-specific
  containerType: "JUG" as ContainerType,
  capacityLb: "",
  // Shared opening balance
  quantity: "0",
  unitCost: "0",
  note: "",
});

const errors = reactive<Record<string, string>>({});
const formError = ref<string | null>(null);
const busy = ref(false);

function setIssues(issues: { path: string; message: string }[]): void {
  for (const i of issues) errors[i.path] = i.message;
}

async function submit(): Promise<void> {
  for (const k of Object.keys(errors)) delete errors[k];
  formError.value = null;
  busy.value = true;
  try {
    if (kind.value === "ITEM") {
      const parsed = openingStockSchema.safeParse({
        sku: form.sku,
        name: form.name,
        itemType: form.itemType,
        physicalForm: form.physicalForm,
        unitOfMeasure: form.unitOfMeasure,
        quantity: form.quantity,
        unitCost: form.unitCost,
        note: form.note || undefined,
      });
      if (!parsed.success) {
        setIssues(parsed.error.issues.map((i) => ({ path: String(i.path[0] ?? ""), message: i.message })));
        return;
      }
      const created = await api.createOpeningStock(parsed.data);
      await router.push({ name: "inventory-edit", params: { id: created.id } });
    } else {
      const parsed = createContainerSchema.safeParse({
        sku: form.sku,
        name: form.name,
        containerType: form.containerType,
        capacityLb: form.capacityLb || undefined,
        standardCost: form.unitCost || "0",
        openingQuantity: form.quantity,
        openingUnitCost: form.unitCost || undefined,
      });
      if (!parsed.success) {
        setIssues(parsed.error.issues.map((i) => ({ path: String(i.path[0] ?? ""), message: i.message })));
        return;
      }
      const created = await api.createContainer(parsed.data);
      await router.push({ name: "container-detail", params: { id: created.id } });
    }
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
  <div class="container" style="max-width: 560px">
    <div class="panel">
      <div class="toolbar">
        <h2 style="margin: 0">Add opening stock</h2>
        <span class="spacer" />
        <button @click="router.push({ name: 'inventory' })">Back</button>
      </div>
      <p class="inactive" style="font-size: 0.85rem">
        Create an item or container together with stock you already hold that
        never came through a purchase order — go-live balances, samples, or found
        stock. Posts a single opening adjustment at the cost you enter. Other
        details can be set afterward on the item / container page.
      </p>
      <div v-if="formError" class="banner error">{{ formError }}</div>

      <div class="field">
        <label>Kind</label>
        <div class="toolbar" style="gap: 1.2rem">
          <label style="font-weight: normal">
            <input type="radio" value="ITEM" v-model="kind" style="width: auto" /> Inventory item
          </label>
          <label style="font-weight: normal">
            <input type="radio" value="CONTAINER" v-model="kind" style="width: auto" /> Container
          </label>
        </div>
      </div>

      <div class="grid-2">
        <div class="field">
          <label>SKU</label>
          <input v-model="form.sku" />
          <div v-if="errors.sku" class="error">{{ errors.sku }}</div>
        </div>
        <div class="field">
          <label>Name</label>
          <input v-model="form.name" />
          <div v-if="errors.name" class="error">{{ errors.name }}</div>
        </div>

        <!-- Item-specific -->
        <template v-if="kind === 'ITEM'">
          <div class="field">
            <label>Item type</label>
            <select v-model="form.itemType">
              <option v-for="t in ITEM_TYPES" :key="t" :value="t">{{ ITEM_TYPE_LABELS[t] }}</option>
            </select>
          </div>
          <div class="field">
            <label>Physical form</label>
            <select v-model="form.physicalForm">
              <option v-for="f in PHYSICAL_FORMS" :key="f" :value="f">{{ PHYSICAL_FORM_LABELS[f] }}</option>
            </select>
          </div>
          <div class="field">
            <label>Handling unit</label>
            <select v-model="form.unitOfMeasure">
              <option v-for="u in UNITS_OF_MEASURE" :key="u" :value="u">{{ u }}</option>
            </select>
          </div>
        </template>

        <!-- Container-specific -->
        <template v-else>
          <div class="field">
            <label>Container type</label>
            <select v-model="form.containerType">
              <option v-for="t in CONTAINER_TYPES" :key="t" :value="t">{{ t }}</option>
            </select>
          </div>
          <div class="field">
            <label>Fill capacity (lb)</label>
            <input v-model="form.capacityLb" inputmode="decimal" placeholder="optional" />
            <div v-if="errors.capacityLb" class="error">{{ errors.capacityLb }}</div>
          </div>
        </template>

        <div class="field">
          <label>Opening quantity{{ kind === 'CONTAINER' ? ' (each)' : '' }}</label>
          <input v-model="form.quantity" :inputmode="kind === 'CONTAINER' ? 'numeric' : 'decimal'" />
          <div v-if="errors.quantity || errors.openingQuantity" class="error">
            {{ errors.quantity || errors.openingQuantity }}
          </div>
        </div>
        <div class="field">
          <label>Unit cost</label>
          <input v-model="form.unitCost" inputmode="decimal" />
          <div v-if="errors.unitCost || errors.openingUnitCost" class="error">
            {{ errors.unitCost || errors.openingUnitCost }}
          </div>
        </div>
        <div v-if="kind === 'ITEM'" class="field">
          <label>Note</label>
          <input v-model="form.note" placeholder="e.g. go-live opening balance" />
        </div>
      </div>

      <div class="toolbar">
        <button class="primary" :disabled="busy || !form.sku || !form.name" @click="submit">
          {{ busy ? "Posting…" : "Create + post opening stock" }}
        </button>
        <button @click="router.push({ name: 'inventory' })">Cancel</button>
      </div>
    </div>
  </div>
</template>
