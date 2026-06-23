<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import {
  type BusinessVariable,
  OPERATOR_ROLE_LABELS,
  type OperatorRole,
  PERMISSIONS,
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

async function load(): Promise<void> {
  error.value = null;
  try {
    apply(await api.getBusinessVariables());
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
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
                  v-model="edits[entryKey(v.key, null)]"
                  inputmode="decimal"
                  :disabled="!canManage"
                  style="text-align: right; max-width: 110px"
                />
                <span class="inactive" style="margin-left: 0.35rem">{{ v.unit }}</span>
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
  </div>
</template>
