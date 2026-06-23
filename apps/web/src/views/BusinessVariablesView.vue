<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import {
  type BusinessVariable,
  type CompanyHoliday,
  HOLIDAY_RULE_TYPES,
  type HolidayRuleType,
  MONTH_LABELS,
  OPERATOR_ROLE_LABELS,
  type OperatorRole,
  PERMISSIONS,
  WEEKDAY_LABELS,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const canManage = auth.hasPermission(PERMISSIONS.BUSINESS_VAR_MANAGE);

const vars = ref<BusinessVariable[]>([]);
// Editable values keyed by "key|role" ("" for non-role-scoped), with the loaded
// originals alongside so we only send what actually changed.
const edits = reactive<Record<string, string>>({});
const original = reactive<Record<string, string>>({});
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = ref(false);

function entryKey(key: string, role: OperatorRole | null): string {
  return `${key}|${role ?? ""}`;
}

const groups = computed(() => [...new Set(vars.value.map((v) => v.group))]);
function varsInGroup(group: string): BusinessVariable[] {
  return vars.value.filter((v) => v.group === group);
}

const changed = computed(() =>
  vars.value.flatMap((v) =>
    v.entries.flatMap((e) => {
      const k = entryKey(v.key, e.operatorRole);
      return edits[k] !== undefined && edits[k] !== original[k]
        ? [{ key: v.key, operatorRole: e.operatorRole ?? undefined, value: edits[k]! }]
        : [];
    }),
  ),
);

function apply(list: BusinessVariable[]): void {
  vars.value = list;
  for (const k of Object.keys(edits)) delete edits[k];
  for (const k of Object.keys(original)) delete original[k];
  for (const v of list) {
    for (const e of v.entries) {
      const k = entryKey(v.key, e.operatorRole);
      edits[k] = e.value;
      original[k] = e.value;
    }
  }
}

// --- Company holidays ---
const holidays = ref<CompanyHoliday[]>([]);
const HOLIDAY_TYPE_LABELS: Record<HolidayRuleType, string> = {
  FIXED: "Fixed date (every year)",
  NTH_WEEKDAY: "Nth weekday of a month",
  EXPLICIT: "One-off date",
};
const NTH_OPTIONS = [
  { value: 1, label: "1st" },
  { value: 2, label: "2nd" },
  { value: 3, label: "3rd" },
  { value: 4, label: "4th" },
  { value: 5, label: "5th" },
  { value: -1, label: "Last" },
];
const newHoliday = reactive({
  name: "",
  ruleType: "FIXED" as HolidayRuleType,
  month: 1,
  day: 1,
  weekday: 4,
  nth: 4,
  date: "",
});
const holidayBusy = ref(false);

async function load(): Promise<void> {
  error.value = null;
  try {
    const [vs, hs] = await Promise.all([
      api.getBusinessVariables(),
      api.getCompanyHolidays(),
    ]);
    apply(vs);
    holidays.value = hs;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

async function addHoliday(): Promise<void> {
  error.value = null;
  notice.value = null;
  const r = newHoliday.ruleType;
  const payload =
    r === "FIXED"
      ? { name: newHoliday.name, ruleType: r, active: true, month: newHoliday.month, day: newHoliday.day }
      : r === "NTH_WEEKDAY"
        ? { name: newHoliday.name, ruleType: r, active: true, month: newHoliday.month, weekday: newHoliday.weekday, nth: newHoliday.nth }
        : { name: newHoliday.name, ruleType: r, active: true, date: newHoliday.date };
  holidayBusy.value = true;
  try {
    await api.createCompanyHoliday(payload);
    newHoliday.name = "";
    newHoliday.date = "";
    holidays.value = await api.getCompanyHolidays();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Could not add holiday";
  } finally {
    holidayBusy.value = false;
  }
}

async function toggleHoliday(h: CompanyHoliday): Promise<void> {
  try {
    await api.updateCompanyHoliday(h.id, { active: !h.active });
    holidays.value = await api.getCompanyHolidays();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Update failed";
  }
}

async function removeHoliday(h: CompanyHoliday): Promise<void> {
  if (!confirm(`Remove holiday "${h.name}"?`)) return;
  try {
    await api.deleteCompanyHoliday(h.id);
    holidays.value = await api.getCompanyHolidays();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Delete failed";
  }
}

async function save(): Promise<void> {
  if (changed.value.length === 0) return;
  busy.value = true;
  error.value = null;
  notice.value = null;
  try {
    apply(await api.updateBusinessVariables({ values: changed.value }));
    notice.value = "Saved.";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Save failed";
  } finally {
    busy.value = false;
  }
}

function isDefault(v: BusinessVariable, role: OperatorRole | null): boolean {
  return v.entries.find((e) => e.operatorRole === role)?.isDefault ?? false;
}

onMounted(load);
</script>

<template>
  <div class="container" style="max-width: 720px">
    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="notice" class="banner ok">{{ notice }}</div>

    <div class="toolbar">
      <h2 style="margin: 0">Business variables</h2>
      <span class="spacer" />
      <button
        v-if="canManage"
        class="primary"
        :disabled="busy || changed.length === 0"
        @click="save"
      >
        {{ busy ? "Saving…" : `Save${changed.length ? ` (${changed.length})` : ""}` }}
      </button>
    </div>
    <p class="inactive" style="font-size: 0.85rem">
      Tenant-wide operational parameters. Unset values fall back to system
      defaults.
      <template v-if="!canManage"> You have read-only access.</template>
    </p>

    <div v-for="group in groups" :key="group" class="panel" style="margin-bottom: 1rem">
      <h3 style="margin-top: 0">{{ group }}</h3>
      <table>
        <tbody>
          <template v-for="v in varsInGroup(group)" :key="v.key">
            <!-- Non-role-scoped: single value -->
            <tr v-if="!v.roleScoped">
              <td>{{ v.label }}</td>
              <td class="num" style="width: 180px">
                <input
                  v-if="v.type === 'TIME'"
                  v-model="edits[entryKey(v.key, null)]"
                  type="time"
                  :disabled="!canManage"
                />
                <input
                  v-else
                  v-model="edits[entryKey(v.key, null)]"
                  inputmode="decimal"
                  :disabled="!canManage"
                  style="text-align: right; max-width: 110px"
                />
                <span v-if="v.unit" class="inactive" style="margin-left: 0.35rem">{{ v.unit }}</span>
              </td>
              <td style="width: 70px">
                <span v-if="isDefault(v, null)" class="inactive" style="font-size: 0.75rem">default</span>
              </td>
            </tr>
            <!-- Role-scoped: one row per operator role -->
            <template v-else>
              <tr>
                <td colspan="3"><strong>{{ v.label }}</strong> <span class="inactive">({{ v.unit }})</span></td>
              </tr>
              <tr v-for="e in v.entries" :key="entryKey(v.key, e.operatorRole)">
                <td style="padding-left: 1.25rem">
                  {{ e.operatorRole ? OPERATOR_ROLE_LABELS[e.operatorRole] : "—" }}
                </td>
                <td class="num" style="width: 180px">
                  <input
                    v-model="edits[entryKey(v.key, e.operatorRole)]"
                    inputmode="decimal"
                    :disabled="!canManage"
                    style="text-align: right; max-width: 110px"
                  />
                  <span class="inactive" style="margin-left: 0.35rem">{{ v.unit }}</span>
                </td>
                <td style="width: 70px">
                  <span v-if="e.isDefault" class="inactive" style="font-size: 0.75rem">default</span>
                </td>
              </tr>
            </template>
          </template>
        </tbody>
      </table>
    </div>

    <div class="panel" style="margin-bottom: 1rem">
      <h3 style="margin-top: 0">Company holidays</h3>
      <p class="inactive" style="font-size: 0.85rem">
        Closure days for working-day / capacity math. Recurring rules cover every
        year; one-off dates are entered manually.
      </p>
      <table>
        <thead>
          <tr><th>Name</th><th>Rule</th><th>Next</th><th>Active</th><th v-if="canManage"></th></tr>
        </thead>
        <tbody>
          <tr v-for="h in holidays" :key="h.id" :class="{ inactive: !h.active }">
            <td>{{ h.name }}</td>
            <td>{{ h.description }}</td>
            <td>{{ h.upcomingDate ?? "—" }}</td>
            <td>
              <input
                type="checkbox"
                :checked="h.active"
                :disabled="!canManage"
                style="width: auto"
                @change="toggleHoliday(h)"
              />
            </td>
            <td v-if="canManage">
              <button class="danger" @click="removeHoliday(h)">Remove</button>
            </td>
          </tr>
          <tr v-if="holidays.length === 0">
            <td :colspan="canManage ? 5 : 4" class="inactive">No holidays defined.</td>
          </tr>
        </tbody>
      </table>

      <div v-if="canManage" class="toolbar" style="flex-wrap: wrap; align-items: center; margin-top: 0.5rem">
        <input v-model="newHoliday.name" placeholder="Holiday name" style="max-width: 180px" />
        <select v-model="newHoliday.ruleType" style="max-width: 200px">
          <option v-for="t in HOLIDAY_RULE_TYPES" :key="t" :value="t">{{ HOLIDAY_TYPE_LABELS[t] }}</option>
        </select>

        <template v-if="newHoliday.ruleType === 'FIXED'">
          <select v-model.number="newHoliday.month" style="max-width: 130px">
            <option v-for="(m, i) in MONTH_LABELS" :key="i" :value="i + 1">{{ m }}</option>
          </select>
          <input v-model.number="newHoliday.day" type="number" min="1" max="31" placeholder="Day" style="max-width: 80px" />
        </template>

        <template v-else-if="newHoliday.ruleType === 'NTH_WEEKDAY'">
          <select v-model.number="newHoliday.nth" style="max-width: 90px">
            <option v-for="o in NTH_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <select v-model.number="newHoliday.weekday" style="max-width: 130px">
            <option v-for="(w, i) in WEEKDAY_LABELS" :key="i" :value="i">{{ w }}</option>
          </select>
          <span class="inactive">of</span>
          <select v-model.number="newHoliday.month" style="max-width: 130px">
            <option v-for="(m, i) in MONTH_LABELS" :key="i" :value="i + 1">{{ m }}</option>
          </select>
        </template>

        <template v-else>
          <input v-model="newHoliday.date" type="date" />
        </template>

        <button class="primary" :disabled="holidayBusy || !newHoliday.name" @click="addHoliday">
          Add holiday
        </button>
      </div>
    </div>
  </div>
</template>
