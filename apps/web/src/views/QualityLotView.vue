<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  type ItemQualitySpec,
  type Lot,
  PERMISSIONS,
  QC_TEST_TYPES,
  type QcTestType,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const props = defineProps<{ id: string }>();
const router = useRouter();
const auth = useAuthStore();

const lot = ref<Lot | null>(null);
const specs = ref<ItemQualitySpec[]>([]);
const measured = reactive<Record<string, string>>({});
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = ref(false);

const TEST_LABELS: Record<QcTestType, string> = {
  SPECIFIC_GRAVITY: "Specific gravity",
  REFRACTIVE_INDEX: "Refractive index",
  COLOR: "Color",
  ODOR: "Odor",
};

const canReview = ref(auth.hasPermission(PERMISSIONS.QC_REVIEW));

function specFor(t: QcTestType): ItemQualitySpec | undefined {
  return specs.value.find((s) => s.testType === t);
}
function specText(t: QcTestType): string {
  const s = specFor(t);
  if (!s) return "—";
  if (s.kind === "NUMERIC") {
    if (s.minValue == null && s.maxValue == null) return "—";
    return `${s.minValue ?? "−∞"} … ${s.maxValue ?? "∞"}`;
  }
  return s.expectedValue ?? "—";
}
function passLabel(passed: boolean | null): string {
  return passed === true ? "✓ pass" : passed === false ? "✗ fail" : "—";
}

async function load(): Promise<void> {
  error.value = null;
  try {
    lot.value = await api.getQualityLot(props.id);
    specs.value = await api.getItemQualitySpec(lot.value.itemId);
    for (const r of lot.value.results) {
      measured[r.testType] = r.measuredValue ?? "";
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

async function recordResults(): Promise<void> {
  busy.value = true;
  error.value = null;
  notice.value = null;
  try {
    const results = QC_TEST_TYPES.map((t) => ({
      testType: t,
      measuredValue: (measured[t] ?? "").trim(),
    })).filter((r) => r.measuredValue !== "");
    if (results.length === 0) {
      error.value = "Enter at least one measured value.";
      return;
    }
    lot.value = await api.recordQualityResults(props.id, { results });
    notice.value = "Results recorded.";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to record";
  } finally {
    busy.value = false;
  }
}

async function approve(): Promise<void> {
  busy.value = true;
  error.value = null;
  notice.value = null;
  try {
    lot.value = await api.approveQualityLot(props.id);
    notice.value = "Lot approved — moved from quarantine to usable inventory.";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Approve failed";
  } finally {
    busy.value = false;
  }
}

async function reject(): Promise<void> {
  const reason = prompt("Reason for rejection (optional):") ?? undefined;
  busy.value = true;
  error.value = null;
  notice.value = null;
  try {
    lot.value = await api.rejectQualityLot(props.id, reason || undefined);
    notice.value = "Lot rejected — stays in quarantine.";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Reject failed";
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="container" style="max-width: 760px">
    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="notice" class="banner ok">{{ notice }}</div>

    <div v-if="lot" class="panel">
      <div class="toolbar">
        <h2 style="margin: 0">Lot {{ lot.lotNumber }}</h2>
        <span class="spacer" />
        <button @click="router.push({ name: 'quality' })">Back</button>
      </div>
      <div class="summary" style="margin-bottom: 1rem">
        <div class="metric"><div class="label">Item</div><div class="value" style="font-size: 1rem">{{ lot.itemName }}</div></div>
        <div class="metric"><div class="label">Source</div><div class="value" style="font-size: 1rem">{{ lot.vendorName ?? lot.workOrderNumber ?? "—" }}</div></div>
        <div class="metric"><div class="label">Qty</div><div class="value" style="font-size: 1rem">{{ lot.quantity }}</div></div>
        <div class="metric"><div class="label">QC status</div><div class="value" style="font-size: 1rem">{{ lot.qcStatus }}</div></div>
      </div>
      <p v-if="lot.rejectionReason" class="banner error">Rejected: {{ lot.rejectionReason }}</p>

      <h3>Acceptance tests</h3>
      <table>
        <thead>
          <tr>
            <th>Test</th>
            <th>Spec</th>
            <th>Measured</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in lot.results" :key="r.testType">
            <td>{{ TEST_LABELS[r.testType] }}</td>
            <td class="inactive">{{ specText(r.testType) }}</td>
            <td>
              <input
                v-if="canReview && lot.qcStatus === 'PENDING'"
                v-model="measured[r.testType]"
                style="max-width: 140px"
              />
              <span v-else>{{ r.measuredValue ?? "—" }}</span>
            </td>
            <td :style="{ color: r.passed === true ? 'var(--ok)' : r.passed === false ? 'var(--danger)' : 'inherit' }">
              {{ passLabel(r.passed) }}
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="canReview && lot.qcStatus === 'PENDING'" class="toolbar">
        <button :disabled="busy" @click="recordResults">Record results</button>
        <span class="spacer" />
        <button class="primary" :disabled="busy" @click="approve">Approve lot</button>
        <button class="danger" :disabled="busy" @click="reject">Reject lot</button>
      </div>
    </div>
  </div>
</template>
