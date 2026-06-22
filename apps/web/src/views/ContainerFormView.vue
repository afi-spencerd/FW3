<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  type Container,
  CONTAINER_TYPES,
  type ContainerTxn,
  createContainerSchema,
  PERMISSIONS,
  SCRAP_REASONS,
  updateContainerSchema,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const props = defineProps<{ id?: string }>();
const router = useRouter();
const auth = useAuthStore();
const isEdit = Boolean(props.id);

const canAdjust = auth.hasPermission(PERMISSIONS.STOCK_ADJUST);
const canScrap = auth.hasPermission(PERMISSIONS.STOCK_SCRAP);

const form = reactive({
  sku: "",
  name: "",
  containerType: "JUG" as (typeof CONTAINER_TYPES)[number],
  capacityLb: "",
  standardCost: "0",
  active: true,
});
const position = ref<Container | null>(null);
const ledger = ref<ContainerTxn[]>([]);
const errors = reactive<Record<string, string>>({});
const formError = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = ref(false);

const adjust = reactive({ direction: "IN" as "IN" | "OUT", quantity: "0", unitCost: "0", note: "" });
const adjustBusy = ref(false);
const scrap = reactive({ quantity: "0", reason: "DAMAGED" as (typeof SCRAP_REASONS)[number], note: "" });
const scrapBusy = ref(false);

function setIssues(issues: { path: string; message: string }[]): void {
  for (const i of issues) errors[i.path] = i.message;
}
function clearErrors(): void {
  for (const k of Object.keys(errors)) delete errors[k];
  formError.value = null;
}

async function loadDetail(): Promise<void> {
  if (!props.id) return;
  const [c, txns] = await Promise.all([
    api.getContainer(props.id),
    api.containerTransactions(props.id),
  ]);
  position.value = c;
  ledger.value = txns;
  Object.assign(form, {
    sku: c.sku,
    name: c.name,
    containerType: c.containerType,
    capacityLb: c.capacityLb ?? "",
    standardCost: c.standardCost,
    active: c.active,
  });
}

onMounted(async () => {
  if (!props.id) return;
  try {
    await loadDetail();
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
      containerType: form.containerType,
      capacityLb: form.capacityLb || undefined,
      standardCost: form.standardCost,
      active: form.active,
    };
    if (isEdit && props.id) {
      const parsed = updateContainerSchema.safeParse(payload);
      if (!parsed.success) {
        setIssues(parsed.error.issues.map((i) => ({ path: String(i.path[0] ?? ""), message: i.message })));
        return;
      }
      await api.updateContainer(props.id, parsed.data);
      await loadDetail();
      notice.value = "Saved.";
    } else {
      const parsed = createContainerSchema.safeParse({ ...payload, sku: form.sku });
      if (!parsed.success) {
        setIssues(parsed.error.issues.map((i) => ({ path: String(i.path[0] ?? ""), message: i.message })));
        return;
      }
      await api.createContainer(parsed.data);
      await router.push({ name: "containers" });
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

async function doAdjust(): Promise<void> {
  if (!props.id) return;
  notice.value = null;
  formError.value = null;
  adjustBusy.value = true;
  try {
    await api.adjustContainer(props.id, {
      direction: adjust.direction,
      quantity: adjust.quantity,
      unitCost: adjust.direction === "IN" ? adjust.unitCost : undefined,
      note: adjust.note || undefined,
    });
    adjust.quantity = "0";
    adjust.note = "";
    await loadDetail();
    notice.value = "Stock adjusted.";
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : "Adjustment failed";
  } finally {
    adjustBusy.value = false;
  }
}

async function doScrap(): Promise<void> {
  if (!props.id) return;
  notice.value = null;
  formError.value = null;
  scrapBusy.value = true;
  try {
    await api.scrapContainer(props.id, {
      quantity: scrap.quantity,
      reason: scrap.reason,
      note: scrap.note || undefined,
    });
    scrap.quantity = "0";
    scrap.note = "";
    await loadDetail();
    notice.value = "Containers scrapped.";
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : "Scrap failed";
  } finally {
    scrapBusy.value = false;
  }
}
</script>

<template>
  <div class="container" style="max-width: 720px">
    <div class="panel">
      <div class="toolbar">
        <h2 style="margin: 0">{{ isEdit ? "Edit container" : "New container" }}</h2>
        <span class="spacer" />
        <button @click="router.push({ name: 'containers' })">Back</button>
      </div>
      <div v-if="formError" class="banner error">{{ formError }}</div>
      <div v-if="notice" class="banner ok">{{ notice }}</div>

      <div class="grid-2">
        <div class="field">
          <label>SKU</label>
          <input v-model="form.sku" :disabled="isEdit" />
          <div v-if="errors.sku" class="error">{{ errors.sku }}</div>
        </div>
        <div class="field">
          <label>Name</label>
          <input v-model="form.name" placeholder="e.g. 5 gal plastic red jug" />
          <div v-if="errors.name" class="error">{{ errors.name }}</div>
        </div>
        <div class="field">
          <label>Type</label>
          <select v-model="form.containerType">
            <option v-for="t in CONTAINER_TYPES" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div class="field">
          <label>Fill capacity (lb)</label>
          <input v-model="form.capacityLb" inputmode="decimal" placeholder="defaults pack count" />
          <div v-if="errors.capacityLb" class="error">{{ errors.capacityLb }}</div>
        </div>
        <div class="field">
          <label>Standard cost</label>
          <input v-model="form.standardCost" inputmode="decimal" />
        </div>
        <div class="field" style="align-self: end">
          <label><input type="checkbox" v-model="form.active" style="width: auto" /> Active</label>
        </div>
      </div>

      <div class="toolbar">
        <button class="primary" :disabled="busy || !form.name" @click="submit">
          {{ busy ? "Saving…" : "Save" }}
        </button>
        <button @click="router.push({ name: 'containers' })">Cancel</button>
      </div>
    </div>

    <div v-if="isEdit && position" class="panel" style="margin-top: 1rem">
      <h3>On hand</h3>
      <div class="summary" style="margin-bottom: 1rem">
        <div class="metric"><div class="label">Count</div><div class="value">{{ position.quantityOnHand }}</div></div>
        <div class="metric"><div class="label">Avg cost</div><div class="value">${{ position.avgCost }}</div></div>
        <div class="metric"><div class="label">Value</div><div class="value">${{ position.totalValue }}</div></div>
      </div>

      <div v-if="canAdjust">
        <h4>Receive / correct stock</h4>
        <div class="toolbar" style="flex-wrap: wrap">
          <select v-model="adjust.direction" style="max-width: 110px">
            <option value="IN">In</option>
            <option value="OUT">Out</option>
          </select>
          <input v-model="adjust.quantity" inputmode="numeric" placeholder="Count" style="max-width: 110px" />
          <input v-if="adjust.direction === 'IN'" v-model="adjust.unitCost" inputmode="decimal" placeholder="Unit cost" style="max-width: 120px" />
          <input v-model="adjust.note" placeholder="Note (optional)" />
          <button :disabled="adjustBusy" @click="doAdjust">{{ adjustBusy ? "Posting…" : "Post" }}</button>
        </div>
      </div>

      <div v-if="canScrap" style="margin-top: 1rem">
        <h4>Scrap damaged containers</h4>
        <div class="toolbar" style="flex-wrap: wrap">
          <input v-model="scrap.quantity" inputmode="numeric" placeholder="Count" style="max-width: 110px" />
          <select v-model="scrap.reason" style="max-width: 160px">
            <option v-for="r in SCRAP_REASONS" :key="r" :value="r">{{ r }}</option>
          </select>
          <input v-model="scrap.note" placeholder="Note (optional)" />
          <button class="danger" :disabled="scrapBusy || Number(scrap.quantity) <= 0" @click="doScrap">
            {{ scrapBusy ? "Scrapping…" : "Scrap" }}
          </button>
        </div>
      </div>

      <h4>Ledger</h4>
      <table>
        <thead>
          <tr><th>When</th><th>Type</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Balance</th><th>Reason</th><th>Note</th></tr>
        </thead>
        <tbody>
          <tr v-for="t in ledger" :key="t.id">
            <td>{{ new Date(t.occurredAt).toLocaleString() }}</td>
            <td>{{ t.type }}</td>
            <td class="num">{{ t.quantity }}</td>
            <td class="num">${{ t.unitCost }}</td>
            <td class="num">{{ t.balanceQty }}</td>
            <td>{{ t.reason ?? "—" }}</td>
            <td>{{ t.note ?? (t.docType ? t.docType : "—") }}</td>
          </tr>
          <tr v-if="ledger.length === 0"><td colspan="7" class="inactive">No transactions yet.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
