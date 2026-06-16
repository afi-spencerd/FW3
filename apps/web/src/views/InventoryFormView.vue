<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  createInventoryItemSchema,
  ITEM_TYPES,
  type ItemType,
  UNITS_OF_MEASURE,
  updateInventoryItemSchema,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";

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

function setIssues(issues: { path: string; message: string }[]): void {
  for (const issue of issues) errors[issue.path] = issue.message;
}

function clearErrors(): void {
  for (const key of Object.keys(errors)) delete errors[key];
  formError.value = null;
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
  </div>
</template>
