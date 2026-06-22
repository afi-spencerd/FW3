<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  type Container,
  createPurchaseOrderSchema,
  type InventoryItem,
  type PoLineType,
  type Vendor,
  type VendorSupplySummary,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";

const router = useRouter();
const vendors = ref<Vendor[]>([]);
const items = ref<InventoryItem[]>([]);
const containers = ref<Container[]>([]);
const summary = reactive<Record<string, VendorSupplySummary>>({});
const issues = ref<string[]>([]);
const busy = ref(false);

interface PoLine {
  kind: PoLineType;
  subjectId: string;
  quantityOrdered: string;
  unitCost: string;
}
const form = reactive({
  vendorId: "",
  poNumber: "",
  notes: "",
  lines: [] as PoLine[],
});

const total = computed(() =>
  form.lines
    .reduce((sum, l) => sum + (Number(l.quantityOrdered) || 0) * (Number(l.unitCost) || 0), 0)
    .toFixed(2),
);

const selectedVendor = computed(() =>
  vendors.value.find((v) => v.id === form.vendorId) ?? null,
);

// Which line kinds a vendor can supply. No vendor (or one with neither flag set,
// i.e. unconfigured) allows both, so lines can be built before picking a vendor.
function allowedKinds(v: Vendor | null): PoLineType[] {
  if (!v || (!v.suppliesMaterials && !v.suppliesContainers)) {
    return ["ITEM", "CONTAINER"];
  }
  const kinds: PoLineType[] = [];
  if (v.suppliesMaterials) kinds.push("ITEM");
  if (v.suppliesContainers) kinds.push("CONTAINER");
  return kinds;
}
const allowed = computed(() => allowedKinds(selectedVendor.value));

// The subject ids currently on the lines — used to find vendors who've supplied
// similar orders before.
const lineSubjectIds = computed(
  () => new Set(form.lines.map((l) => l.subjectId).filter(Boolean)),
);
function priorMatches(vendorId: string): number {
  const s = summary[vendorId];
  if (!s) return 0;
  const supplied = new Set([...s.itemIds, ...s.containerIds]);
  let n = 0;
  for (const id of lineSubjectIds.value) if (supplied.has(id)) n++;
  return n;
}
// Vendors ordered for the dropdown: when lines reference known subjects, the
// vendors who've supplied the most of them float to the top.
const rankedVendors = computed(() => {
  const list = [...vendors.value];
  if (lineSubjectIds.value.size === 0) return list;
  return list.sort((a, b) => {
    const d = priorMatches(b.id) - priorMatches(a.id);
    return d !== 0 ? d : a.name.localeCompare(b.name);
  });
});
function vendorLabel(v: Vendor): string {
  const matches = priorMatches(v.id);
  if (matches > 0) return `${v.name} — ★ supplied ${matches} of these before`;
  const poCount = summary[v.id]?.poCount ?? 0;
  return poCount > 0 ? `${v.name} — ${poCount} prior order(s)` : v.name;
}
// Top suggestions to nudge the user when they've added lines but no vendor yet.
const suggestedVendors = computed(() =>
  lineSubjectIds.value.size === 0 || form.vendorId
    ? []
    : vendors.value
        .filter((v) => priorMatches(v.id) > 0)
        .sort((a, b) => priorMatches(b.id) - priorMatches(a.id))
        .slice(0, 3),
);

function addLine(): void {
  form.lines.push({
    kind: allowed.value[0] ?? "ITEM",
    subjectId: "",
    quantityOrdered: "0",
    unitCost: "0",
  });
}
function removeLine(i: number): void {
  form.lines.splice(i, 1);
}
// Reset the chosen subject when switching a line between item and container.
function onKindChange(line: PoLine): void {
  line.subjectId = "";
}

// When the vendor changes, drop any line whose kind the vendor doesn't supply
// back to an allowed kind (and clear its subject) so the form stays consistent.
watch(
  () => form.vendorId,
  () => {
    const kinds = allowed.value;
    for (const line of form.lines) {
      if (!kinds.includes(line.kind)) {
        line.kind = kinds[0] ?? "ITEM";
        line.subjectId = "";
      }
    }
  },
);

onMounted(async () => {
  try {
    const [v, inv, cont, sum] = await Promise.all([
      api.listVendors(),
      api.listInventory({ pageSize: 200 }),
      api.listContainers(),
      api.vendorSupplySummary(),
    ]);
    vendors.value = v.filter((x) => x.isActive);
    // Procurable: raw materials and bases (not finished goods).
    items.value = inv.items.filter((i) => i.itemType !== "FINISHED_GOOD");
    containers.value = cont.filter((c) => c.active);
    for (const s of sum) summary[s.vendorId] = s;
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
      vendorId: form.vendorId,
      poNumber: form.poNumber,
      notes: form.notes || undefined,
      lines: form.lines.map((l, i) => ({
        itemId: l.kind === "ITEM" ? l.subjectId : undefined,
        containerId: l.kind === "CONTAINER" ? l.subjectId : undefined,
        quantityOrdered: l.quantityOrdered,
        unitCost: l.unitCost,
        sortOrder: i,
      })),
    };
    const parsed = createPurchaseOrderSchema.safeParse(payload);
    if (!parsed.success) {
      issues.value = parsed.error.issues.map(
        (i) => `${i.path.join(".") || "form"}: ${i.message}`,
      );
      return;
    }
    const created = await api.createPurchaseOrder(parsed.data);
    await router.push({ name: "purchase-order-detail", params: { id: created.id } });
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
      <h2>New purchase order</h2>
      <ul v-if="issues.length" class="banner error" style="margin: 0 0 1rem; padding-left: 1.5rem">
        <li v-for="(m, i) in issues" :key="i">{{ m }}</li>
      </ul>

      <div class="grid-2">
        <div class="field">
          <label>Vendor</label>
          <select v-model="form.vendorId">
            <option value="" disabled>Select a vendor…</option>
            <option v-for="v in rankedVendors" :key="v.id" :value="v.id">
              {{ vendorLabel(v) }}
            </option>
          </select>
          <div v-if="suggestedVendors.length" class="inactive" style="font-size: 0.8rem">
            Suggested (supplied these before):
            {{ suggestedVendors.map((v) => v.name).join(", ") }}
          </div>
        </div>
        <div class="field">
          <label>PO number</label>
          <input v-model="form.poNumber" />
        </div>
      </div>
      <div class="field">
        <label>Notes</label>
        <input v-model="form.notes" />
      </div>

      <h3>Lines</h3>
      <p class="inactive" style="font-size: 0.8rem">
        A line can buy a material/base or a container (packaging). Container
        receipts go straight to container stock — no QC/quarantine.
      </p>
      <table>
        <thead>
          <tr>
            <th style="width: 110px">Kind</th>
            <th>Subject</th>
            <th class="num" style="width: 100px">Qty</th>
            <th class="num" style="width: 110px">Unit cost</th>
            <th style="width: 40px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(line, index) in form.lines" :key="index">
            <td>
              <select v-model="line.kind" @change="onKindChange(line)">
                <option v-if="allowed.includes('ITEM')" value="ITEM">Material</option>
                <option v-if="allowed.includes('CONTAINER')" value="CONTAINER">Container</option>
              </select>
            </td>
            <td>
              <select v-if="line.kind === 'ITEM'" v-model="line.subjectId">
                <option value="" disabled>Select an item…</option>
                <option v-for="it in items" :key="it.id" :value="it.id">
                  {{ it.name }} ({{ it.sku }}) · {{ it.unitOfMeasure }}
                </option>
              </select>
              <select v-else v-model="line.subjectId">
                <option value="" disabled>Select a container…</option>
                <option v-for="c in containers" :key="c.id" :value="c.id">
                  {{ c.name }} ({{ c.sku }}) · each
                </option>
              </select>
            </td>
            <td class="num"><input v-model="line.quantityOrdered" inputmode="decimal" style="text-align: right" /></td>
            <td class="num"><input v-model="line.unitCost" inputmode="decimal" style="text-align: right" /></td>
            <td><button class="danger" @click="removeLine(index)">✕</button></td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2"><button @click="addLine">+ Add line</button></td>
            <td></td>
            <td class="num"><strong>${{ total }}</strong></td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      <div class="toolbar">
        <button class="primary" :disabled="busy" @click="submit">
          {{ busy ? "Saving…" : "Create PO" }}
        </button>
        <button @click="router.push({ name: 'purchase-orders' })">Cancel</button>
      </div>
    </div>
  </div>
</template>
