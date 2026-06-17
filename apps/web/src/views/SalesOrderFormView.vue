<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  createSalesOrderSchema,
  type Customer,
  type InventoryItem,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";

const router = useRouter();
const customers = ref<Customer[]>([]);
const items = ref<InventoryItem[]>([]);
const issues = ref<string[]>([]);
const busy = ref(false);

const form = reactive({
  customerId: "",
  soNumber: "",
  notes: "",
  lines: [] as { itemId: string; quantityOrdered: string; unitPrice: string }[],
});

const total = computed(() =>
  form.lines
    .reduce((sum, l) => sum + (Number(l.quantityOrdered) || 0) * (Number(l.unitPrice) || 0), 0)
    .toFixed(2),
);

function addLine(): void {
  form.lines.push({ itemId: "", quantityOrdered: "0", unitPrice: "0" });
}
function removeLine(i: number): void {
  form.lines.splice(i, 1);
}

onMounted(async () => {
  try {
    const [c, inv] = await Promise.all([
      api.listCustomers(),
      api.listInventory({ pageSize: 200 }),
    ]);
    customers.value = c.filter((x) => x.isActive);
    // Sellable: finished goods and bases (not raw materials).
    items.value = inv.items.filter((i) => i.itemType !== "RAW_MATERIAL");
    addLine();
  } catch (err) {
    issues.value = [err instanceof ApiError ? err.message : "Failed to load"];
  }
});

async function submit(): Promise<void> {
  issues.value = [];
  busy.value = true;
  try {
    const payload = {
      customerId: form.customerId,
      soNumber: form.soNumber,
      notes: form.notes || undefined,
      lines: form.lines.map((l, i) => ({
        itemId: l.itemId,
        quantityOrdered: l.quantityOrdered,
        unitPrice: l.unitPrice,
        sortOrder: i,
      })),
    };
    const parsed = createSalesOrderSchema.safeParse(payload);
    if (!parsed.success) {
      issues.value = parsed.error.issues.map(
        (i) => `${i.path.join(".") || "form"}: ${i.message}`,
      );
      return;
    }
    const created = await api.createSalesOrder(parsed.data);
    await router.push({ name: "sales-order-detail", params: { id: created.id } });
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
  <div class="container" style="max-width: 800px">
    <div class="panel">
      <h2>New sales order</h2>
      <ul v-if="issues.length" class="banner error" style="margin: 0 0 1rem; padding-left: 1.5rem">
        <li v-for="(m, i) in issues" :key="i">{{ m }}</li>
      </ul>

      <div class="grid-2">
        <div class="field">
          <label>Customer</label>
          <select v-model="form.customerId">
            <option value="" disabled>Select a customer…</option>
            <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="field">
          <label>SO number</label>
          <input v-model="form.soNumber" />
        </div>
      </div>
      <div class="field">
        <label>Notes</label>
        <input v-model="form.notes" />
      </div>

      <h3>Lines</h3>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th class="num" style="width: 120px">Qty</th>
            <th class="num" style="width: 120px">Unit price</th>
            <th style="width: 40px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in form.lines" :key="index">
            <td>
              <select v-model="line.itemId">
                <option value="" disabled>Select an item…</option>
                <option v-for="it in items" :key="it.id" :value="it.id">
                  {{ it.name }} ({{ it.sku }}) · {{ it.unitOfMeasure }}
                </option>
              </select>
            </td>
            <td class="num"><input v-model="line.quantityOrdered" inputmode="decimal" style="text-align: right" /></td>
            <td class="num"><input v-model="line.unitPrice" inputmode="decimal" style="text-align: right" /></td>
            <td><button class="danger" @click="removeLine(index)">✕</button></td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td><button @click="addLine">+ Add line</button></td>
            <td></td>
            <td class="num"><strong>${{ total }}</strong></td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      <div class="toolbar">
        <button class="primary" :disabled="busy" @click="submit">
          {{ busy ? "Saving…" : "Create SO" }}
        </button>
        <button @click="router.push({ name: 'sales-orders' })">Cancel</button>
      </div>
    </div>
  </div>
</template>
