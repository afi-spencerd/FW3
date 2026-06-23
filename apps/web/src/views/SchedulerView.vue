<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { RouterLink } from "vue-router";
import type { SchedulerBoard, SchedulerMaterial, SchedulerWorkOrder } from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";

const board = ref<SchedulerBoard>({ requested: [], queued: [] });
const error = ref<string | null>(null);
const busy = ref(false);
// Requested WOs selected for "queue by rules".
const selected = reactive<Record<string, boolean>>({});
// Items we've already alerted purchasing about this session (to disable the button).
const alerted = reactive<Record<string, boolean>>({});
// Manual "queue at position" input per requested WO (1-based, as shown).
const manualPos = reactive<Record<string, string>>({});
// Drag-and-drop state.
const dragged = ref<{ id: string; from: "requested" | "queued" } | null>(null);
const dragOverIndex = ref<number | null>(null);

async function load(): Promise<void> {
  error.value = null;
  try {
    board.value = await api.schedulerBoard();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

async function run(fn: () => Promise<SchedulerBoard>): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    board.value = await fn();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Action failed";
  } finally {
    busy.value = false;
  }
}

const selectedIds = computed(() =>
  board.value.requested.filter((w) => selected[w.id]).map((w) => w.id),
);

function queue(wo: SchedulerWorkOrder): void {
  // Queue at its suggested slot (server default when position omitted).
  run(() => api.enqueueWorkOrder(wo.id));
}
function queueAt(wo: SchedulerWorkOrder): void {
  const n = Number(manualPos[wo.id]);
  if (!manualPos[wo.id] || Number.isNaN(n)) return;
  const pos = Math.max(0, Math.min(n - 1, board.value.queued.length));
  delete manualPos[wo.id];
  run(() => api.enqueueWorkOrder(wo.id, pos));
}
function queueSelected(): void {
  const ids = selectedIds.value;
  if (ids.length === 0) return;
  for (const id of ids) delete selected[id];
  run(() => api.queueByRules(ids));
}
function release(wo: SchedulerWorkOrder): void {
  run(() => api.releaseWorkOrder(wo.id));
}
function releaseAll(): void {
  const n = board.value.queued.length;
  if (n === 0) return;
  if (!confirm(`Release all ${n} queued work orders to the floor?`)) return;
  run(() => api.releaseAllWorkOrders());
}
function reposition(wo: SchedulerWorkOrder, position: number): void {
  const clamped = Math.max(0, Math.min(position, board.value.queued.length - 1));
  if (clamped === wo.queuePosition) return;
  run(() => api.repositionWorkOrder(wo.id, clamped));
}

// ---- drag and drop ----
function onDragStart(
  id: string,
  from: "requested" | "queued",
  e: DragEvent,
): void {
  dragged.value = { id, from };
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }
}
function onDragEnd(): void {
  dragged.value = null;
  dragOverIndex.value = null;
}
function onDragOver(index: number): void {
  dragOverIndex.value = index;
}
function onDrop(index: number): void {
  const d = dragged.value;
  dragOverIndex.value = null;
  dragged.value = null;
  if (!d) return;
  const queued = board.value.queued;
  if (d.from === "requested") {
    const pos = Math.max(0, Math.min(index, queued.length));
    run(() => api.enqueueWorkOrder(d.id, pos));
  } else {
    // Reposition within the queue. The server inserts into the queue *without*
    // this item, so dropping below its current slot shifts the target down one.
    const cur = queued.findIndex((w) => w.id === d.id);
    let pos = index;
    if (cur !== -1 && cur < index) pos -= 1;
    pos = Math.max(0, Math.min(pos, queued.length - 1));
    if (cur === pos) return;
    run(() => api.repositionWorkOrder(d.id, pos));
  }
}

function shortQty(m: SchedulerMaterial): string {
  return (Number(m.requiredQty) - Number(m.availableQty)).toString();
}
async function alertPurchasing(
  wo: SchedulerWorkOrder,
  m: SchedulerMaterial,
): Promise<void> {
  try {
    await api.createPurchasingAlert({
      itemId: m.componentId,
      workOrderId: wo.id,
      shortQty: shortQty(m),
      note: `Short for ${wo.workOrderNumber} (${wo.targetName})`,
    });
    alerted[`${wo.id}:${m.componentId}`] = true;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to raise alert";
  }
}

onMounted(load);
</script>

<template>
  <div class="container">
    <div v-if="error" class="banner error">{{ error }}</div>
    <div class="toolbar">
      <h2 style="margin: 0">Production scheduler</h2>
      <span class="spacer" />
      <button
        class="btn primary"
        :disabled="busy || selectedIds.length === 0"
        @click="queueSelected"
      >
        Queue selected by rules ({{ selectedIds.length }})
      </button>
    </div>
    <p class="inactive" style="font-size: 0.8rem; margin-top: 0">
      Drag a requested card into the queue to place it at a position, or drag
      queued cards to reorder. No mouse? Use “Queue at” / the ↑↓ buttons.
    </p>

    <div class="board">
      <!-- Requested column -->
      <div class="panel col">
        <h3>Requested ({{ board.requested.length }})</h3>
        <p v-if="board.requested.length === 0" class="inactive">
          Nothing requested. Customer service requests production from a paid (or
          net-terms) sales order.
        </p>
        <div
          v-for="wo in board.requested"
          :key="wo.id"
          class="card grab"
          draggable="true"
          @dragstart="onDragStart(wo.id, 'requested', $event)"
          @dragend="onDragEnd"
        >
          <div class="card-head">
            <label class="pick">
              <input type="checkbox" v-model="selected[wo.id]" />
            </label>
            <strong>{{ wo.workOrderNumber }}</strong>
            <span v-if="wo.isRush" class="tag rush">RUSH</span>
            <span v-if="wo.feasibility.blocked" class="tag blocked">BLOCKED</span>
            <span class="spacer" />
            <span class="inactive">sugg. pos {{ wo.suggestedPosition }}</span>
          </div>
          <div class="meta">
            {{ wo.targetName }} · {{ wo.batchSize }} lb ·
            {{ wo.customerName ?? "—" }}
            <span v-if="wo.customerRating">(rating {{ wo.customerRating }})</span>
            <template v-if="wo.requestedShipDate">
              · ship {{ new Date(wo.requestedShipDate).toLocaleDateString() }}
            </template>
          </div>

          <!-- Material / container shortfalls -->
          <ul v-if="wo.feasibility.blocked" class="shortfalls">
            <li v-for="m in wo.feasibility.materials.filter((x) => x.short)" :key="m.componentId">
              {{ m.sku }}: need {{ m.requiredQty }}, have {{ m.availableQty }}
              <button
                class="btn small"
                :disabled="alerted[`${wo.id}:${m.componentId}`]"
                @click="alertPurchasing(wo, m)"
              >
                {{ alerted[`${wo.id}:${m.componentId}`] ? "Alerted" : "Alert purchasing" }}
              </button>
            </li>
            <li v-if="wo.feasibility.container?.short">
              Container {{ wo.feasibility.container.sku }}: need
              {{ wo.feasibility.container.requiredQty }}, have
              {{ wo.feasibility.container.availableQty }}
            </li>
          </ul>

          <div class="meta inactive">
            {{ wo.feasibility.manpower.poursNeeded }} pours · capacity
            {{ wo.feasibility.manpower.dailyCapacity }}/day
            <span v-if="!wo.feasibility.manpower.withinCapacity"> · over capacity</span>
          </div>

          <div class="card-actions">
            <button class="btn" :disabled="busy" @click="queue(wo)">
              Queue → (pos {{ wo.suggestedPosition }})
            </button>
            <span class="spacer" />
            <input
              v-model="manualPos[wo.id]"
              class="pos-input"
              inputmode="numeric"
              :placeholder="String((wo.suggestedPosition ?? 0) + 1)"
              :title="`Queue position (1–${board.queued.length + 1})`"
            />
            <button class="btn small" :disabled="busy || !manualPos[wo.id]" @click="queueAt(wo)">
              Queue at
            </button>
          </div>
        </div>
      </div>

      <!-- Queued column (drop target) -->
      <div
        class="panel col"
        @dragover.prevent
        @drop="onDrop(board.queued.length)"
      >
        <h3 style="display: flex; align-items: center; gap: 0.5rem">
          Queued ({{ board.queued.length }})
          <span class="spacer" />
          <button
            class="btn primary small"
            :disabled="busy || board.queued.length === 0"
            @click="releaseAll"
          >
            Release all
          </button>
        </h3>

        <div
          v-if="board.queued.length === 0"
          class="dropzone"
          :class="{ over: dragOverIndex === 0 }"
          @dragover.prevent="onDragOver(0)"
          @drop.stop="onDrop(0)"
        >
          {{ dragged ? "Drop here to queue" : "Queue is empty." }}
        </div>

        <template v-for="(wo, i) in board.queued" :key="wo.id">
          <div class="ins" :class="{ on: dragOverIndex === i }" />
          <div
            class="card grab"
            draggable="true"
            @dragstart="onDragStart(wo.id, 'queued', $event)"
            @dragend="onDragEnd"
            @dragover.prevent.stop="onDragOver(i)"
            @drop.stop="onDrop(i)"
          >
            <div class="card-head">
              <strong>#{{ (wo.queuePosition ?? 0) + 1 }}</strong>
              {{ wo.workOrderNumber }}
              <span v-if="wo.isRush" class="tag rush">RUSH</span>
              <span v-if="wo.feasibility.blocked" class="tag blocked">BLOCKED</span>
            </div>
            <div class="meta">
              {{ wo.targetName }} · {{ wo.customerName ?? "—" }}
              <span v-if="wo.customerRating">(rating {{ wo.customerRating }})</span>
            </div>
            <div class="card-actions">
              <button
                class="btn small"
                :disabled="busy || (wo.queuePosition ?? 0) === 0"
                @click="reposition(wo, (wo.queuePosition ?? 0) - 1)"
              >
                ↑
              </button>
              <button
                class="btn small"
                :disabled="busy || (wo.queuePosition ?? 0) >= board.queued.length - 1"
                @click="reposition(wo, (wo.queuePosition ?? 0) + 1)"
              >
                ↓
              </button>
              <span class="spacer" />
              <button class="btn primary" :disabled="busy" @click="release(wo)">
                Release to floor
              </button>
            </div>
          </div>
        </template>
        <div class="ins" :class="{ on: dragOverIndex === board.queued.length }" />

        <p class="inactive" style="font-size: 0.8rem; margin-top: 1rem">
          Releasing hands the work order to the floor (it becomes a planned run)
          without moving any material — staging is the floor's step. See the
          <RouterLink :to="{ name: 'production-queue' }">run queue</RouterLink>.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.board {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  align-items: start;
}
.col h3 {
  margin-top: 0;
}
.card {
  border: 1px solid var(--border, #d1d5db);
  border-radius: 6px;
  padding: 0.6rem 0.75rem;
  margin-bottom: 0.6rem;
}
.card.grab {
  cursor: grab;
}
.card.grab:active {
  cursor: grabbing;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.pick {
  display: inline-flex;
}
.meta {
  font-size: 0.85rem;
  margin: 0.25rem 0;
}
.card-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.4rem;
}
.pos-input {
  width: 48px;
  text-align: right;
}
.shortfalls {
  margin: 0.3rem 0;
  padding-left: 1.1rem;
  font-size: 0.8rem;
  color: #b91c1c;
}
.shortfalls li {
  margin: 0.15rem 0;
}
.tag {
  font-size: 0.68rem;
  font-weight: 700;
  padding: 0.05rem 0.35rem;
  border-radius: 3px;
}
.tag.rush {
  background: #fef3c7;
  color: #92400e;
}
.tag.blocked {
  background: #fee2e2;
  color: #b91c1c;
}
.btn.small {
  padding: 0.1rem 0.4rem;
  font-size: 0.75rem;
}
/* Insertion marker shown between cards while dragging. */
.ins {
  height: 0;
  margin: 0;
  border-top: 2px solid transparent;
  transition: border-color 0.05s;
}
.ins.on {
  border-top-color: #2563eb;
  margin: 0.2rem 0;
}
.dropzone {
  border: 2px dashed #cbd5e1;
  border-radius: 6px;
  padding: 1rem;
  text-align: center;
  color: #64748b;
  font-size: 0.85rem;
}
.dropzone.over {
  border-color: #2563eb;
  background: #eff6ff;
}
</style>
