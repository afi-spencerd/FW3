<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import {
  composeLocationCode,
  isStockableKind,
  type Location,
  type LocationKind,
  LOCATION_KINDS,
  type LocationStockRow,
  PARENT_KIND,
  PERMISSIONS,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const locations = ref<Location[]>([]);
const error = ref<string | null>(null);
const busy = ref(false);
const canManage = auth.hasPermission(PERMISSIONS.LOCATION_MANAGE);

const KIND_LABELS: Record<LocationKind, string> = {
  BUILDING: "Building",
  AISLE: "Aisle",
  RACK: "Rack",
  AREA: "Area",
};
const VALUE_LABELS: Record<LocationKind, string> = {
  BUILDING: "Building code (3 digits, e.g. 075)",
  AISLE: "Aisle letter (A–Z)",
  RACK: "Rack number (1–9; odd = left, even = right)",
  AREA: "Area code (e.g. RECV)",
};
const KIND_INDENT: Record<LocationKind, number> = {
  BUILDING: 0,
  AISLE: 1,
  RACK: 2,
  AREA: 1,
};

const form = reactive({
  id: null as string | null,
  kind: "BUILDING" as LocationKind,
  parentId: "",
  value: "",
  name: "",
  isDefault: false,
  isReceiving: false,
  active: true,
});

function reset(): void {
  form.id = null;
  form.kind = "BUILDING";
  form.parentId = "";
  form.value = "";
  form.name = "";
  form.isDefault = false;
  form.isReceiving = false;
  form.active = true;
}

const parentKind = computed(() => PARENT_KIND[form.kind]);
const parentOptions = computed(() =>
  parentKind.value ? locations.value.filter((l) => l.kind === parentKind.value) : [],
);
const stockableKind = computed(() => isStockableKind(form.kind));
const codePreview = computed(() => {
  if (!form.value) return "";
  const parent = locations.value.find((l) => l.id === form.parentId);
  if (form.kind !== "BUILDING" && !parent) return "(choose a parent)";
  try {
    return composeLocationCode(form.kind, parent?.code ?? null, form.value);
  } catch {
    return "";
  }
});

// Reset parent + flags whenever the kind changes (valid parents / flags differ).
watch(
  () => form.kind,
  () => {
    if (form.id) return;
    form.parentId = "";
    if (!isStockableKind(form.kind)) {
      form.isDefault = false;
      form.isReceiving = false;
    }
  },
);

function editLocation(l: Location): void {
  form.id = l.id;
  form.kind = l.kind;
  form.parentId = l.parentId ?? "";
  form.value = l.segment;
  form.name = l.name;
  form.isDefault = l.isDefault;
  form.isReceiving = l.isReceiving;
  form.active = l.active;
}

async function load(): Promise<void> {
  error.value = null;
  try {
    locations.value = await api.listLocations();
    await loadContents();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  }
}

async function save(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    if (form.id) {
      // Editing only touches the label / role / active (code & kind are fixed).
      await api.updateLocation(form.id, {
        name: form.name,
        isDefault: form.isDefault,
        isReceiving: form.isReceiving,
        active: form.active,
      });
    } else {
      await api.createLocation({
        kind: form.kind,
        name: form.name,
        value: form.value,
        parentId: form.parentId || undefined,
        isDefault: form.isDefault,
        isReceiving: form.isReceiving,
        active: form.active,
      });
    }
    reset();
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Save failed";
  } finally {
    busy.value = false;
  }
}

// --- Location contents browser ---
const contents = ref<LocationStockRow[]>([]);
const selectedIds = ref<string[]>([]); // empty = all
const contentsBusy = ref(false);

function toggleLocation(id: string): void {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((x) => x !== id)
    : [...selectedIds.value, id];
}

// A selection may include buildings/aisles; expand to the stockable leaves under
// them (a leaf matches if it, its aisle, or its building is selected).
const selectedLeafIds = computed<string[] | undefined>(() => {
  if (!selectedIds.value.length) return undefined;
  const sel = new Set(selectedIds.value);
  return locations.value
    .filter((l) => isStockableKind(l.kind))
    .filter(
      (l) =>
        sel.has(l.id) ||
        (l.parentId !== null && sel.has(l.parentId)) ||
        (l.buildingId !== null && sel.has(l.buildingId)),
    )
    .map((l) => l.id);
});

async function loadContents(): Promise<void> {
  contentsBusy.value = true;
  try {
    contents.value = await api.locationContents(selectedLeafIds.value);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load contents";
  } finally {
    contentsBusy.value = false;
  }
}
watch(selectedIds, loadContents);

interface ContentsGroup {
  locationId: string;
  code: string;
  name: string;
  buildingName: string | null;
  rows: LocationStockRow[];
  totalValue: number;
}
const grouped = computed<ContentsGroup[]>(() => {
  const map = new Map<string, ContentsGroup>();
  for (const r of contents.value) {
    let g = map.get(r.locationId);
    if (!g) {
      g = {
        locationId: r.locationId,
        code: r.locationCode ?? "",
        name: r.locationName,
        buildingName: r.buildingName,
        rows: [],
        totalValue: 0,
      };
      map.set(r.locationId, g);
    }
    g.rows.push(r);
    g.totalValue += Number(r.totalValue);
  }
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
});

onMounted(load);
</script>

<template>
  <div class="container">
    <div v-if="error" class="banner error">{{ error }}</div>

    <div class="panel" style="margin-bottom: 1rem">
      <h3 style="margin-top: 0">What's in a location</h3>
      <p class="inactive" style="font-size: 0.85rem">
        Pick locations to see their contents — choosing a building or aisle
        includes everything under it. With none selected, all inventory is shown.
        Located inventory only (INV &amp; quarantine).
      </p>
      <div class="toolbar" style="flex-wrap: wrap; gap: 0.3rem 1rem">
        <label
          v-for="l in locations"
          :key="l.id"
          :class="{ inactive: !l.active }"
          :style="{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            paddingLeft: KIND_INDENT[l.kind] * 0.9 + 'rem',
          }"
        >
          <input
            type="checkbox"
            style="width: auto"
            :checked="selectedIds.includes(l.id)"
            @change="toggleLocation(l.id)"
          />
          <span style="font-variant-numeric: tabular-nums">{{ l.code }}</span>
          <span class="inactive">{{ l.name }}</span>
        </label>
        <button v-if="selectedIds.length" @click="selectedIds = []">Show all</button>
      </div>

      <p v-if="!contentsBusy && grouped.length === 0" class="inactive">
        No located inventory in the selected location(s).
      </p>

      <div v-for="g in grouped" :key="g.locationId" style="margin-top: 1rem">
        <h4 style="margin-bottom: 0.25rem">
          <span style="font-variant-numeric: tabular-nums">{{ g.code }}</span>
          — {{ g.buildingName ? g.buildingName + " · " : "" }}{{ g.name }}
          <span class="inactive" style="font-weight: normal; font-size: 0.85rem">
            ({{ g.rows.length }} item(s), ${{ g.totalValue.toFixed(2) }})
          </span>
        </h4>
        <table>
          <thead>
            <tr>
              <th>SKU</th><th>Item</th><th>Type</th><th>Status</th>
              <th class="num">Quantity</th><th class="num">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in g.rows" :key="r.itemId + r.status">
              <td>{{ r.sku }}</td>
              <td>
                <RouterLink :to="{ name: 'inventory-edit', params: { id: r.itemId } }">
                  {{ r.name }}
                </RouterLink>
              </td>
              <td>{{ r.itemType }}</td>
              <td>{{ r.status }}</td>
              <td class="num">{{ r.quantity }}</td>
              <td class="num">${{ r.totalValue }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="canManage" class="panel" style="margin-bottom: 1rem">
      <h3>{{ form.id ? "Edit location" : "New location" }}</h3>
      <div class="grid-2">
        <div v-if="!form.id" class="field">
          <label>Kind</label>
          <select v-model="form.kind">
            <option v-for="k in LOCATION_KINDS" :key="k" :value="k">{{ KIND_LABELS[k] }}</option>
          </select>
        </div>
        <div v-if="!form.id && parentKind" class="field">
          <label>Parent ({{ KIND_LABELS[parentKind] }})</label>
          <select v-model="form.parentId">
            <option value="">Select…</option>
            <option v-for="p in parentOptions" :key="p.id" :value="p.id">
              {{ p.code }} — {{ p.name }}
            </option>
          </select>
        </div>
        <div v-if="!form.id" class="field">
          <label>{{ VALUE_LABELS[form.kind] }}</label>
          <input v-model="form.value" />
          <div class="inactive" style="font-size: 0.8rem">
            Code: <strong>{{ codePreview || "—" }}</strong>
          </div>
        </div>
        <div class="field">
          <label>Name</label>
          <input v-model="form.name" />
        </div>
        <div v-if="stockableKind" class="field">
          <label>
            <input type="checkbox" v-model="form.isDefault" style="width: auto" />
            Default storage (usable inventory lands here)
          </label>
        </div>
        <div v-if="stockableKind" class="field">
          <label>
            <input type="checkbox" v-model="form.isReceiving" style="width: auto" />
            Receiving (received goods quarantine here)
          </label>
        </div>
        <div class="field">
          <label><input type="checkbox" v-model="form.active" style="width: auto" /> Active</label>
        </div>
      </div>
      <div class="toolbar">
        <button
          class="primary"
          :disabled="busy || !form.name || (!form.id && !form.value)"
          @click="save"
        >
          {{ form.id ? "Save" : "Add location" }}
        </button>
        <button v-if="form.id" @click="reset">Cancel</button>
      </div>
    </div>

    <div class="panel">
      <h3 style="margin-top: 0">Locations</h3>
      <p class="inactive" style="font-size: 0.85rem">
        Tree of building → aisle → rack (bin/sub-bin reserved), plus areas like
        receiving. Codes follow bbb-a-nnn. Inventory sits at racks and areas.
      </p>
      <table>
        <thead>
          <tr><th>Code</th><th>Name</th><th>Kind</th><th>Side</th><th>Role</th><th>Active</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="l in locations" :key="l.id" :class="{ inactive: !l.active }">
            <td :style="{ paddingLeft: KIND_INDENT[l.kind] * 1 + 'rem', fontVariantNumeric: 'tabular-nums' }">
              {{ l.code }}
            </td>
            <td>{{ l.name }}</td>
            <td>{{ KIND_LABELS[l.kind] }}</td>
            <td>{{ l.side ?? "" }}</td>
            <td>
              <span v-if="l.isDefault" class="badge">Default</span>
              <span v-if="l.isReceiving" class="badge">Receiving</span>
            </td>
            <td>{{ l.active ? "Yes" : "No" }}</td>
            <td>
              <button v-if="canManage" @click="editLocation(l)">Edit</button>
            </td>
          </tr>
          <tr v-if="locations.length === 0">
            <td colspan="7" class="inactive">No locations yet.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
