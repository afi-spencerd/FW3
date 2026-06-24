<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import type {
  ImportSalesOrderRow,
  ImportSalesOrdersResult,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { parseCsvObjects } from "../lib/csv";

const router = useRouter();

const REQUIRED = ["soNumber", "customer", "sku", "quantity", "unitPrice"];
const TEMPLATE =
  "soNumber,customer,customerPo,lineType,sku,quantity,unitPrice,requestedShipDate,notes,packingSku,packingQty,allowBelowCost\n" +
  "5147184,ACME,PO-9981,ITEM,FG-NOIR-01,100,42.50,2026-07-01,First order,CT-JUG-WHITE,2,\n" +
  "5147184,ACME,PO-9981,CONTAINER,CT-DRUM-55,5,75,,,,,\n";

const rawText = ref("");
const rows = ref<ImportSalesOrderRow[]>([]);
const parseError = ref<string | null>(null);
const result = ref<ImportSalesOrdersResult | null>(null);
const busy = ref(false);

function parse(): void {
  parseError.value = null;
  result.value = null;
  rows.value = [];
  if (!rawText.value.trim()) return;
  const { rows: parsed, missingHeaders } = parseCsvObjects<ImportSalesOrderRow>(
    rawText.value,
    REQUIRED,
    (get) => {
      const lineType = get("lineType").toUpperCase() === "CONTAINER" ? "CONTAINER" : "ITEM";
      const belowRaw = get("allowBelowCost").toLowerCase();
      return {
        soNumber: get("soNumber"),
        customer: get("customer"),
        customerPo: get("customerPo") || undefined,
        lineType,
        sku: get("sku"),
        quantity: get("quantity"),
        unitPrice: get("unitPrice"),
        requestedShipDate: get("requestedShipDate") || undefined,
        notes: get("notes") || undefined,
        packingSku: get("packingSku") || undefined,
        packingQty: get("packingQty") || undefined,
        allowBelowCost: ["true", "1", "yes", "y"].includes(belowRaw) || undefined,
      };
    },
  );
  if (missingHeaders.length) {
    parseError.value = `Missing required column(s): ${missingHeaders.join(", ")}`;
    return;
  }
  if (parsed.length === 0) {
    parseError.value = "No data rows found.";
    return;
  }
  rows.value = parsed;
}

async function onFile(e: Event): Promise<void> {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  rawText.value = await file.text();
  parse();
}

// Group parsed rows by soNumber for the preview.
const groups = computed(() => {
  const m = new Map<string, ImportSalesOrderRow[]>();
  for (const r of rows.value) {
    const g = m.get(r.soNumber) ?? [];
    g.push(r);
    m.set(r.soNumber, g);
  }
  return [...m.entries()].map(([soNumber, lines]) => ({ soNumber, lines }));
});

async function doImport(): Promise<void> {
  busy.value = true;
  parseError.value = null;
  try {
    result.value = await api.importSalesOrders(rows.value);
  } catch (err) {
    parseError.value = err instanceof ApiError ? err.message : "Import failed";
  } finally {
    busy.value = false;
  }
}

function downloadTemplate(): void {
  const url = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "sales-order-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="container" style="max-width: 900px">
    <div class="panel">
      <div class="toolbar">
        <h2 style="margin: 0">Import sales orders (CSV)</h2>
        <span class="spacer" />
        <button @click="downloadTemplate">Download template</button>
        <button @click="router.push({ name: 'sales-orders' })">Back</button>
      </div>
      <p class="inactive" style="font-size: 0.85rem">
        One row per order line; rows sharing a <code>soNumber</code> become one
        order. <code>customer</code> matches a customer code or name;
        <code>sku</code> is an item SKU (or a container SKU when
        <code>lineType</code> is CONTAINER). Required columns: soNumber, customer,
        sku, quantity, unitPrice.
      </p>

      <div class="field">
        <label>Choose a CSV file</label>
        <input type="file" accept=".csv,text/csv" @change="onFile" />
      </div>
      <div class="field">
        <label>…or paste CSV</label>
        <textarea v-model="rawText" rows="5" @blur="parse" placeholder="soNumber,customer,sku,quantity,unitPrice…" />
      </div>

      <div v-if="parseError" class="banner error">{{ parseError }}</div>

      <!-- Preview -->
      <template v-if="rows.length && !result">
        <h3>Preview — {{ groups.length }} order(s), {{ rows.length }} line(s)</h3>
        <table>
          <thead>
            <tr>
              <th>SO #</th><th>Customer</th><th>Type</th><th>SKU</th>
              <th class="num">Qty</th><th class="num">Unit price</th><th>Packing</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="g in groups" :key="g.soNumber">
              <tr v-for="(l, i) in g.lines" :key="g.soNumber + i">
                <td>{{ i === 0 ? g.soNumber : "" }}</td>
                <td>{{ i === 0 ? l.customer : "" }}</td>
                <td>{{ l.lineType }}</td>
                <td>{{ l.sku }}</td>
                <td class="num">{{ l.quantity }}</td>
                <td class="num">{{ l.unitPrice }}</td>
                <td>
                  <template v-if="l.packingSku">{{ l.packingQty }} × {{ l.packingSku }}</template>
                  <span v-else class="inactive">—</span>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <div class="toolbar">
          <button class="primary" :disabled="busy" @click="doImport">
            {{ busy ? "Importing…" : `Import ${groups.length} order(s)` }}
          </button>
        </div>
      </template>

      <!-- Results -->
      <template v-if="result">
        <h3>
          Imported — {{ result.created }} created,
          <span :class="{ below: result.failed > 0 }">{{ result.failed }} failed</span>
        </h3>
        <table>
          <thead>
            <tr><th>SO #</th><th>Status</th><th class="num">Lines</th><th>Detail</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in result.results" :key="r.soNumber">
              <td>{{ r.soNumber }}</td>
              <td :class="{ below: r.status === 'FAILED' }">{{ r.status }}</td>
              <td class="num">{{ r.lineCount }}</td>
              <td>
                <RouterLink
                  v-if="r.salesOrderId"
                  :to="{ name: 'sales-order-detail', params: { id: r.salesOrderId } }"
                >
                  view
                </RouterLink>
                <span v-else>{{ r.error }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="toolbar">
          <button @click="router.push({ name: 'sales-orders' })">Done</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.below {
  color: #b91c1c;
  font-weight: 600;
}
textarea {
  width: 100%;
  font-family: monospace;
}
</style>
