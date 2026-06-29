<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  kgEquivalent,
  PERMISSIONS,
  POUR_LOCATION_LABELS,
  type ProductionWorkOrder,
  type SalesOrder,
  type SalesOrderSummary,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const props = defineProps<{ id: string }>();
const router = useRouter();
const auth = useAuthStore();

const run = ref<ProductionWorkOrder | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = ref(false);

const canExecute = computed(() => auth.hasPermission(PERMISSIONS.PRODUCTION_EXECUTE));
const canSchedule = computed(() => auth.hasPermission(PERMISSIONS.PRODUCTION_SCHEDULE));

// ---- Reassignment ----
const salesOrders = ref<SalesOrderSummary[]>([]);
const showReassign = ref(false);
const targetSoId = ref("");
const targetSo = ref<SalesOrder | null>(null);
const targetLineId = ref("");

// Live orders other than the one this batch is already reserved for.
const reassignTargets = computed(() =>
  salesOrders.value.filter(
    (s) => s.status !== "CANCELLED" && s.id !== run.value?.salesOrderId,
  ),
);

// Lines on the chosen order that order the item this work order produces — the
// batch can only be re-reserved against a matching line.
const matchingLines = computed(() => {
  if (!targetSo.value || !run.value) return [];
  return targetSo.value.lines.filter(
    (l) => l.lineType === "ITEM" && l.itemId === run.value!.targetItemId,
  );
});

async function openReassign(): Promise<void> {
  showReassign.value = true;
  if (salesOrders.value.length === 0) {
    try {
      salesOrders.value = await api.listSalesOrders();
    } catch (err) {
      error.value = err instanceof ApiError ? err.message : "Failed to load orders";
    }
  }
}

async function loadTargetSo(): Promise<void> {
  targetSo.value = null;
  targetLineId.value = "";
  if (!targetSoId.value) return;
  try {
    targetSo.value = await api.getSalesOrder(targetSoId.value);
    // Pin the line automatically when there's exactly one match.
    if (matchingLines.value.length === 1) {
      targetLineId.value = matchingLines.value[0]!.id;
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load order";
  }
}

async function confirmReassign(): Promise<void> {
  if (!run.value || !targetSoId.value || !targetLineId.value) return;
  await act(
    () =>
      api.reassignProductionWorkOrder(run.value!.id, {
        salesOrderId: targetSoId.value,
        salesOrderLineId: targetLineId.value,
      }),
    "Work order reassigned. The original sales order line now needs a new batch.",
  );
  showReassign.value = false;
  targetSoId.value = "";
  targetSo.value = null;
  targetLineId.value = "";
}

type Line = ProductionWorkOrder["lines"][number];

/**
 * A pour can't proceed if neither bucket covers the requirement: on-hand (INV,
 * stageable) plus already-staged WIP is short of what the line needs. INV/WIP are
 * per-item totals, so this ignores contention with other work orders.
 */
function isShort(line: Line): boolean {
  const available = Number(line.invAvailable ?? 0) + Number(line.wipAvailable ?? 0);
  return available < Number(line.requiredQty);
}

async function load(): Promise<void> {
  error.value = null;
  try {
    run.value = await api.getProductionWorkOrder(props.id);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

async function act(fn: () => Promise<ProductionWorkOrder>, msg: string): Promise<void> {
  busy.value = true;
  error.value = null;
  notice.value = null;
  try {
    run.value = await fn();
    notice.value = msg;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Action failed";
  } finally {
    busy.value = false;
  }
}

const stage = () =>
  act(() => api.stageProductionWorkOrder(props.id), "Components staged into WIP.");
const complete = () =>
  act(
    () => api.completeProductionWorkOrder(props.id),
    "Work order completed — finished goods are in FG_WIP. Pack off from the Inventory page.",
  );
const cancel = () =>
  act(() => api.cancelProductionWorkOrder(props.id), "Work order cancelled.");

onMounted(load);
</script>

<template>
  <div class="container" style="max-width: 820px">
    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="notice" class="banner ok">{{ notice }}</div>

    <div v-if="run" class="panel">
      <div class="toolbar">
        <h2 style="margin: 0">{{ run.workOrderNumber }}</h2>
        <span class="spacer" />
        <button @click="router.push({ name: 'production' })">Back</button>
      </div>
      <div class="summary" style="margin-bottom: 1rem">
        <div class="metric"><div class="label">Target</div><div class="value" style="font-size: 1rem">{{ run.targetName }}</div></div>
        <div class="metric"><div class="label">Status</div><div class="value" style="font-size: 1rem">{{ run.status }}</div></div>
        <div class="metric"><div class="label">Batch</div><div class="value" style="font-size: 1rem">{{ run.batchSize }} {{ run.batchUnit }}</div></div>
        <div class="metric"><div class="label">Output</div><div class="value" style="font-size: 1rem">{{ run.outputQty }}</div></div>
        <div class="metric">
          <div class="label">Reserved for</div>
          <div class="value" style="font-size: 1rem">{{ run.soNumber ?? "Unreserved" }}</div>
        </div>
      </div>
      <p class="inactive" style="font-size: 0.85rem">Formula: {{ run.formulaName }}</p>

      <h3>Components</h3>
      <table>
        <thead>
          <tr>
            <th>Component</th>
            <th class="num">Required (lb)</th>
            <th class="num">Staged (lb)</th>
            <th class="num">Consumed (lb)</th>
            <th class="num">On-hand (lb)</th>
            <th class="num">Staged WIP (lb)</th>
            <th class="num">kg equivalent</th>
            <th>Assigned to</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="line in run.lines" :key="line.id">
            <td>{{ line.componentName }} <span class="inactive">({{ line.componentSku }})</span></td>
            <td class="num">{{ line.requiredQty }}</td>
            <td class="num">{{ line.stagedQty }}</td>
            <td class="num">{{ line.consumedQty }}</td>
            <td class="num" :class="{ short: isShort(line) }">
              {{ line.invAvailable ?? "0" }}
              <span v-if="isShort(line)" title="Not enough material to pour">⚠</span>
            </td>
            <td class="num">{{ line.wipAvailable ?? "0" }}</td>
            <td class="num">
              {{ line.handlingUnit === "KG" ? kgEquivalent(line.requiredQty) + " kg" : "—" }}
            </td>
            <td>{{ line.assignedLocation ? POUR_LOCATION_LABELS[line.assignedLocation] : "—" }}</td>
          </tr>
        </tbody>
      </table>

      <div v-if="canExecute" class="toolbar">
        <button
          v-if="run.status === 'PLANNED'"
          class="primary"
          :disabled="busy"
          @click="stage"
        >
          Stage components (INV → WIP)
        </button>
        <button
          v-if="run.status === 'STAGED'"
          class="primary"
          :disabled="busy"
          @click="complete"
        >
          Complete (consume → FG_WIP)
        </button>
        <button v-if="run.status === 'PLANNED'" class="danger" :disabled="busy" @click="cancel">
          Cancel
        </button>
      </div>

      <div v-if="canSchedule && run.status !== 'CANCELLED'" class="reassign">
        <button v-if="!showReassign" :disabled="busy" @click="openReassign">
          Reassign to another sales order…
        </button>
        <div v-else>
          <h3 style="margin-bottom: 0.25rem">Reassign work order</h3>
          <p class="inactive" style="font-size: 0.85rem; margin-top: 0">
            Re-reserves this batch — and any finished goods it has already
            produced — for the chosen order. The current order's line will need a
            new batch.
          </p>
          <div class="toolbar" style="gap: 0.5rem">
            <select v-model="targetSoId" style="max-width: 280px" @change="loadTargetSo">
              <option value="">Select a sales order…</option>
              <option v-for="s in reassignTargets" :key="s.id" :value="s.id">
                {{ s.soNumber }} — {{ s.customerName }}
              </option>
            </select>
            <select
              v-if="matchingLines.length > 1"
              v-model="targetLineId"
              style="max-width: 280px"
            >
              <option value="">Select a line…</option>
              <option v-for="l in matchingLines" :key="l.id" :value="l.id">
                {{ l.itemSku }} — {{ l.quantityOrdered }} ordered
              </option>
            </select>
          </div>
          <p
            v-if="targetSo && matchingLines.length === 0"
            class="banner error"
            style="font-size: 0.85rem"
          >
            {{ run.targetName }} ({{ run.targetSku }}) isn't on that order — pick an
            order that includes this item.
          </p>
          <div class="toolbar">
            <button
              class="primary"
              :disabled="busy || !targetSoId || !targetLineId"
              @click="confirmReassign"
            >
              Confirm reassignment
            </button>
            <button :disabled="busy" @click="showReassign = false">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.short {
  color: #b45309;
  font-weight: 600;
}
</style>
