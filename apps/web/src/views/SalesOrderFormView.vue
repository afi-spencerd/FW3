<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  type Container,
  containersForWeight,
  createSalesOrderSchema,
  type Customer,
  type CustomerItemPrice,
  type InventoryItem,
  type ItemCost,
  PERMISSIONS,
  type SoLineType,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const router = useRouter();
const auth = useAuthStore();
const canOverride = auth.hasPermission(PERMISSIONS.SO_PRICE_OVERRIDE);
const customers = ref<Customer[]>([]);
const items = ref<InventoryItem[]>([]);
const containers = ref<Container[]>([]);
// Per-item cost basis (per lb), fetched on demand and cached by item id.
const itemCosts = reactive<Record<string, ItemCost>>({});
// Profit margin (%) used to suggest prices. Sourced from the rating-scoped
// `profitMarginPct` business variable: a base value plus per-rating overrides.
const marginPct = ref(30);
const baseMargin = ref(30);
const marginByRating = reactive<Record<string, number>>({});
// This customer's historic price per item (loaded when the customer changes).
const priceHistory = reactive<Record<string, CustomerItemPrice>>({});
const allowBelowCost = ref(false);
const issues = ref<string[]>([]);
const busy = ref(false);

interface SoLine {
  lineType: SoLineType;
  itemId: string;
  productContainerId: string;
  quantityOrdered: string;
  unitPrice: string;
  containerId: string;
  containerQuantity: string;
}
const form = reactive({
  customerId: "",
  soNumber: "",
  requestedShipDate: "",
  notes: "",
  lines: [] as SoLine[],
});

async function fetchCost(itemId: string): Promise<void> {
  if (!itemId || itemCosts[itemId]) return;
  try {
    itemCosts[itemId] = await api.getItemCost(itemId);
  } catch {
    /* leave uncosted; server still enforces on save */
  }
}
function suggestPrice(line: SoLine, unitCost: number): void {
  const suggested = unitCost * (1 + marginPct.value / 100);
  line.unitPrice = String(Math.round(suggested * 10000) / 10000);
}
async function onItemChange(line: SoLine): Promise<void> {
  recalcContainers(line);
  await fetchCost(line.itemId);
  const c = itemCosts[line.itemId];
  if (c) suggestPrice(line, Number(c.productionUnitCost));
}
function onLineTypeChange(line: SoLine): void {
  // Reset subject-specific fields when toggling between item / container.
  line.itemId = "";
  line.productContainerId = "";
  line.containerId = "";
  line.containerQuantity = "";
  line.unitPrice = "0";
}
function containerById(id: string): Container | undefined {
  return containers.value.find((x) => x.id === id);
}
function containerUnit(id: string): number {
  const c = containerById(id);
  if (!c) return 0;
  const avg = Number(c.avgCost);
  return avg > 0 ? avg : Number(c.standardCost);
}
function onProductContainerChange(line: SoLine): void {
  if (line.productContainerId) suggestPrice(line, containerUnit(line.productContainerId));
}

async function loadPriceHistory(): Promise<void> {
  for (const k of Object.keys(priceHistory)) delete priceHistory[k];
  if (!form.customerId) return;
  try {
    for (const r of await api.customerPriceHistory(form.customerId)) {
      priceHistory[r.itemId] = r;
    }
  } catch {
    /* history is advisory */
  }
}

// Pick the price-suggestion margin for the selected customer's rating; unrated
// customers (and ratings without an override) fall back to the base margin.
function recomputeMargin(): void {
  const rating = customers.value.find((c) => c.id === form.customerId)?.rating;
  marginPct.value = (rating && marginByRating[rating]) ?? baseMargin.value;
}

async function onCustomerChange(): Promise<void> {
  recomputeMargin();
  await loadPriceHistory();
}

/** All-in cost per unit for the line. */
function lineUnitCost(line: SoLine): number | null {
  const cost = lineCost(line);
  const qty = Number(line.quantityOrdered) || 0;
  return cost !== null && qty > 0 ? cost / qty : null;
}
function useHistoricAvg(line: SoLine): void {
  const h = priceHistory[line.itemId];
  if (h) line.unitPrice = h.avgUnitPrice;
}

function packingAvg(line: SoLine): number {
  return containerUnit(line.containerId);
}
/** Full computed cost of a line, or null if uncosted. */
function lineCost(line: SoLine): number | null {
  const qty = Number(line.quantityOrdered) || 0;
  if (line.lineType === "CONTAINER") {
    if (!line.productContainerId) return null;
    return qty * containerUnit(line.productContainerId);
  }
  const c = itemCosts[line.itemId];
  if (!c) return null;
  let cost = qty * Number(c.productionUnitCost);
  if (line.containerId && line.containerQuantity) {
    cost += (Number(line.containerQuantity) || 0) * packingAvg(line);
  }
  return cost;
}
function lineRevenue(line: SoLine): number {
  return (Number(line.quantityOrdered) || 0) * (Number(line.unitPrice) || 0);
}
function lineMargin(line: SoLine): number | null {
  const cost = lineCost(line);
  const rev = lineRevenue(line);
  if (cost === null || rev <= 0) return null;
  return ((rev - cost) / rev) * 100;
}
function belowCost(line: SoLine): boolean {
  const cost = lineCost(line);
  return cost !== null && cost > 0 && lineRevenue(line) < cost;
}
const totalCost = computed(() =>
  form.lines.reduce((sum, l) => sum + (lineCost(l) ?? 0), 0).toFixed(2),
);
const anyBelowCost = computed(() => form.lines.some((l) => belowCost(l)));
// Below-cost lines block saving unless an authorized user opts to override.
const blockedByCost = computed(
  () => anyBelowCost.value && !(canOverride && allowBelowCost.value),
);

// Default the container count from fill capacity (overridable). Recomputed when
// the line's quantity or chosen packing container changes (item lines only).
function recalcContainers(line: SoLine): void {
  const c = containerById(line.containerId);
  if (!c) return;
  const suggested = containersForWeight(line.quantityOrdered, c.capacityLb);
  if (suggested > 0) line.containerQuantity = String(suggested);
}

const total = computed(() =>
  form.lines
    .reduce((sum, l) => sum + (Number(l.quantityOrdered) || 0) * (Number(l.unitPrice) || 0), 0)
    .toFixed(2),
);

function addLine(): void {
  form.lines.push({
    lineType: "ITEM",
    itemId: "",
    productContainerId: "",
    quantityOrdered: "0",
    unitPrice: "0",
    containerId: "",
    containerQuantity: "",
  });
}
function removeLine(i: number): void {
  form.lines.splice(i, 1);
}

onMounted(async () => {
  // Default the requested ship date to 3 days out (sales can adjust it).
  const ship = new Date(Date.now() + 3 * 86_400_000);
  form.requestedShipDate = ship.toISOString().slice(0, 10);
  try {
    const [c, inv, cont, vars] = await Promise.all([
      api.listCustomers(),
      api.listInventory({ pageSize: 200 }),
      api.listContainers(),
      api.getBusinessVariables(),
    ]);
    customers.value = c.filter((x) => x.isActive);
    // Any item tier is sellable now (raw materials, bases, finished goods).
    items.value = inv.items.filter((i) => i.active);
    containers.value = cont.filter((x) => x.active);
    const marginVar = vars.find((v) => v.key === "profitMarginPct");
    if (marginVar) {
      for (const e of marginVar.entries) {
        if (e.customerRating) marginByRating[e.customerRating] = Number(e.value);
        else baseMargin.value = Number(e.value);
      }
    }
    marginPct.value = baseMargin.value;
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
      requestedShipDate: form.requestedShipDate
        ? new Date(form.requestedShipDate).toISOString()
        : undefined,
      notes: form.notes || undefined,
      allowBelowCost: allowBelowCost.value || undefined,
      lines: form.lines.map((l, i) => ({
        lineType: l.lineType,
        itemId: l.lineType === "ITEM" ? l.itemId : undefined,
        productContainerId:
          l.lineType === "CONTAINER" ? l.productContainerId : undefined,
        quantityOrdered: l.quantityOrdered,
        unitPrice: l.unitPrice,
        sortOrder: i,
        containerId: l.lineType === "ITEM" && l.containerId ? l.containerId : undefined,
        containerQuantity:
          l.lineType === "ITEM" && l.containerId
            ? l.containerQuantity || undefined
            : undefined,
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
  <div class="container" style="max-width: 860px">
    <div class="panel">
      <h2>New sales order</h2>
      <ul v-if="issues.length" class="banner error" style="margin: 0 0 1rem; padding-left: 1.5rem">
        <li v-for="(m, i) in issues" :key="i">{{ m }}</li>
      </ul>

      <div class="grid-2">
        <div class="field">
          <label>Customer</label>
          <select v-model="form.customerId" @change="onCustomerChange">
            <option value="" disabled>Select a customer…</option>
            <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="field">
          <label>SO number</label>
          <input v-model="form.soNumber" />
        </div>
      </div>
      <div class="grid-2">
        <div class="field">
          <label>Requested ship date</label>
          <input v-model="form.requestedShipDate" type="date" />
        </div>
        <div class="field">
          <label>Notes</label>
          <input v-model="form.notes" />
        </div>
      </div>

      <h3>Lines</h3>
      <p class="inactive" style="font-size: 0.8rem">
        Sell an inventory item or a container itself. Item lines may also choose a
        packing container (count defaults from fill capacity, overridable).
      </p>
      <table>
        <thead>
          <tr>
            <th style="width: 90px">Type</th>
            <th>Item / container</th>
            <th class="num" style="width: 80px">Qty</th>
            <th class="num" style="width: 95px">Unit price</th>
            <th style="width: 160px">Packing</th>
            <th class="num" style="width: 70px">Count</th>
            <th class="num" style="width: 85px">Cost</th>
            <th class="num" style="width: 60px">Margin</th>
            <th style="width: 36px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in form.lines" :key="index">
            <td>
              <select v-model="line.lineType" @change="onLineTypeChange(line)">
                <option value="ITEM">Item</option>
                <option value="CONTAINER">Container</option>
              </select>
            </td>
            <td>
              <select
                v-if="line.lineType === 'ITEM'"
                v-model="line.itemId"
                @change="onItemChange(line)"
              >
                <option value="" disabled>Select an item…</option>
                <option v-for="it in items" :key="it.id" :value="it.id">
                  {{ it.name }} ({{ it.sku }}) · {{ it.unitOfMeasure }}
                </option>
              </select>
              <select v-else v-model="line.productContainerId" @change="onProductContainerChange(line)">
                <option value="" disabled>Select a container…</option>
                <option v-for="c in containers" :key="c.id" :value="c.id">
                  {{ c.name }} ({{ c.sku }})
                </option>
              </select>
            </td>
            <td class="num">
              <input
                v-model="line.quantityOrdered"
                inputmode="decimal"
                style="text-align: right"
                @change="recalcContainers(line)"
              />
            </td>
            <td class="num">
              <input v-model="line.unitPrice" inputmode="decimal" style="text-align: right" />
              <div
                v-if="line.lineType === 'ITEM' && priceHistory[line.itemId]"
                class="inactive"
                style="font-size: 0.7rem"
              >
                cust avg ${{ priceHistory[line.itemId]!.avgUnitPrice }}
                <a href="#" @click.prevent="useHistoricAvg(line)">use</a>
              </div>
            </td>
            <td>
              <select
                v-if="line.lineType === 'ITEM'"
                v-model="line.containerId"
                @change="recalcContainers(line)"
              >
                <option value="">— none —</option>
                <option v-for="c in containers" :key="c.id" :value="c.id">
                  {{ c.name }} ({{ c.sku }})<template v-if="c.capacityLb"> · {{ c.capacityLb }} lb</template>
                </option>
              </select>
              <span v-else class="inactive">—</span>
            </td>
            <td class="num">
              <input
                v-if="line.lineType === 'ITEM'"
                v-model="line.containerQuantity"
                inputmode="numeric"
                style="text-align: right"
                :disabled="!line.containerId"
                placeholder="—"
              />
              <span v-else class="inactive">—</span>
            </td>
            <td class="num" :class="{ below: belowCost(line) }">
              <template v-if="lineCost(line) !== null">${{ lineCost(line)!.toFixed(2) }}</template>
              <span v-else class="inactive">—</span>
              <div v-if="lineUnitCost(line) !== null" class="inactive" style="font-size: 0.7rem">
                ${{ lineUnitCost(line)!.toFixed(2) }}/unit
              </div>
            </td>
            <td class="num" :class="{ below: belowCost(line) }">
              <template v-if="lineMargin(line) !== null">{{ lineMargin(line)!.toFixed(1) }}%</template>
              <span v-else class="inactive">—</span>
            </td>
            <td><button class="danger" @click="removeLine(index)">✕</button></td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td><button @click="addLine">+ Add line</button></td>
            <td></td>
            <td></td>
            <td class="num">Rev <strong>${{ total }}</strong></td>
            <td></td>
            <td></td>
            <td class="num">Cost <strong>${{ totalCost }}</strong></td>
            <td></td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      <div v-if="anyBelowCost" class="banner error" style="margin-top: 1rem">
        One or more lines are priced below cost.
        <label v-if="canOverride" style="display: block; margin-top: 0.4rem; font-weight: normal">
          <input type="checkbox" v-model="allowBelowCost" style="width: auto" />
          Override and sell below cost (recorded in the audit trail)
        </label>
        <span v-else> You are not permitted to sell below cost — raise the price to continue.</span>
      </div>

      <div class="toolbar">
        <button class="primary" :disabled="busy || blockedByCost" @click="submit">
          {{ busy ? "Saving…" : "Create SO" }}
        </button>
        <button @click="router.push({ name: 'sales-orders' })">Cancel</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.below {
  color: #b91c1c;
  font-weight: 600;
}
</style>
