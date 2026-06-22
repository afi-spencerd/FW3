<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
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

const form = reactive({
  sku: "",
  name: "",
  itemType: "RAW_MATERIAL" as ItemType,
  physicalForm: "LIQUID" as PhysicalForm,
  unitOfMeasure: "LB",
  quantity: "0",
  unitCost: "0",
  note: "",
});

const errors = reactive<Record<string, string>>({});
const formError = ref<string | null>(null);
const busy = ref(false);

async function submit(): Promise<void> {
  for (const k of Object.keys(errors)) delete errors[k];
  formError.value = null;
  busy.value = true;
  try {
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
      for (const i of parsed.error.issues) {
        errors[String(i.path[0] ?? "")] = i.message;
      }
      return;
    }
    const created = await api.createOpeningStock(parsed.data);
    // Land on the new item's page to complete its details if needed.
    await router.push({ name: "inventory-edit", params: { id: created.id } });
  } catch (err) {
    if (err instanceof ApiError) {
      formError.value = err.message;
      if (err.issues) for (const i of err.issues) errors[i.path] = i.message;
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
        Create an item together with stock you already hold that never came
        through a purchase order — go-live balances, samples, or found stock.
        Posts a single opening adjustment at the cost you enter. Other details
        (regulatory, accounts, price) can be set afterward on the item page.
      </p>
      <div v-if="formError" class="banner error">{{ formError }}</div>

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
        <div class="field">
          <label>Opening quantity</label>
          <input v-model="form.quantity" inputmode="decimal" />
          <div v-if="errors.quantity" class="error">{{ errors.quantity }}</div>
        </div>
        <div class="field">
          <label>Unit cost</label>
          <input v-model="form.unitCost" inputmode="decimal" />
          <div v-if="errors.unitCost" class="error">{{ errors.unitCost }}</div>
        </div>
        <div class="field">
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
