<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  type ItemQualitySpec,
  type Lot,
  PERMISSIONS,
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
// Judgment tests (odor, appearance) are passed/failed manually by the analyst.
const judgment = reactive<Record<string, "" | "PASS" | "FAIL">>({});
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = ref(false);

const TEST_LABELS: Record<QcTestType, string> = {
  SPECIFIC_GRAVITY: "Specific gravity",
  REFRACTIVE_INDEX: "Refractive index",
  GARDNER_COLOR: "Gardner color (1–18)",
  ODOR: "Odor",
  APPEARANCE: "Appearance",
  MELTING_POINT: "Melting point (°C)",
};

const canReview = ref(auth.hasPermission(PERMISSIONS.QC_REVIEW));
const canReturn = auth.hasPermission(PERMISSIONS.VENDOR_RETURN);

// Return-to-vendor (QC-failed RM).
const ret = reactive({ quantity: "", rmaNumber: "", note: "" });
const remaining = computed(() =>
  lot.value ? Number(lot.value.quantity) - Number(lot.value.returnedQty) : 0,
);

async function returnToVendor(): Promise<void> {
  busy.value = true;
  error.value = null;
  notice.value = null;
  try {
    await api.returnLotToVendor(props.id, {
      quantity: ret.quantity || undefined,
      rmaNumber: ret.rmaNumber || undefined,
      note: ret.note || undefined,
    });
    ret.quantity = "";
    ret.rmaNumber = "";
    ret.note = "";
    lot.value = await api.getQualityLot(props.id);
    notice.value = "Returned to vendor — removed from quarantine.";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Return failed";
  } finally {
    busy.value = false;
  }
}

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
      if (r.kind === "JUDGMENT") {
        judgment[r.testType] =
          r.passed === true ? "PASS" : r.passed === false ? "FAIL" : "";
      }
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
    // Only the lot's own suite is recorded. Numeric tests auto-evaluate against
    // the spec; judgment tests carry the analyst's explicit pass/fail.
    const results = (lot.value?.results ?? []).flatMap((r) => {
      const measuredValue = (measured[r.testType] ?? "").trim();
      if (measuredValue === "") return [];
      if (r.kind === "JUDGMENT") {
        const j = judgment[r.testType];
        return [
          {
            testType: r.testType,
            measuredValue,
            ...(j === "PASS" ? { passed: true } : {}),
            ...(j === "FAIL" ? { passed: false } : {}),
          },
        ];
      }
      return [{ testType: r.testType, measuredValue }];
    });
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
            <td>
              {{ TEST_LABELS[r.testType] }}
              <span class="inactive" style="font-size: 0.75rem">
                ({{ r.kind === "NUMERIC" ? "numeric" : "judgment" }})
              </span>
            </td>
            <td class="inactive">{{ specText(r.testType) }}</td>
            <td>
              <template v-if="canReview && lot.qcStatus === 'PENDING'">
                <input
                  v-model="measured[r.testType]"
                  :placeholder="r.kind === 'JUDGMENT' ? 'observation' : 'value'"
                  style="max-width: 140px"
                />
                <select
                  v-if="r.kind === 'JUDGMENT'"
                  v-model="judgment[r.testType]"
                  style="max-width: 110px; margin-left: 0.4rem"
                >
                  <option value="">—</option>
                  <option value="PASS">Pass</option>
                  <option value="FAIL">Fail</option>
                </select>
              </template>
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

      <div
        v-if="lot.origin === 'RECEIPT' && (lot.qcStatus === 'REJECTED' || lot.qcStatus === 'RETURNED')"
        style="margin-top: 1.5rem"
      >
        <h3>Return to vendor</h3>
        <p class="inactive" style="font-size: 0.85rem">
          Send QC-failed material back to {{ lot.vendorName ?? "the vendor" }} —
          removes it from quarantine as a recoverable debit (not a loss).
          Returned {{ lot.returnedQty }} of {{ lot.quantity }}.
        </p>
        <div v-if="canReturn && remaining > 0" class="toolbar" style="flex-wrap: wrap">
          <input
            v-model="ret.quantity"
            inputmode="decimal"
            :placeholder="`Qty (default ${remaining})`"
            style="max-width: 170px"
          />
          <input v-model="ret.rmaNumber" placeholder="RMA # (optional)" style="max-width: 160px" />
          <input v-model="ret.note" placeholder="Note (optional)" />
          <button class="danger" :disabled="busy" @click="returnToVendor">
            Return to vendor
          </button>
        </div>
        <p v-else-if="remaining <= 0" class="banner ok">Fully returned to vendor.</p>
      </div>
    </div>
  </div>
</template>
