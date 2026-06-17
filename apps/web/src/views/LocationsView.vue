<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import {
  type Location,
  type LocationStockRow,
  PERMISSIONS,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const locations = ref<Location[]>([]);
const error = ref<string | null>(null);
const busy = ref(false);
const canManage = auth.hasPermission(PERMISSIONS.LOCATION_MANAGE);

// --- Location contents browser ---
const contents = ref<LocationStockRow[]>([]);
const selectedIds = ref<string[]>([]); // empty = all locations
const contentsBusy = ref(false);

function toggleLocation(id: string): void {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((x) => x !== id)
    : [...selectedIds.value, id];
}

async function loadContents(): Promise<void> {
  contentsBusy.value = true;
  try {
    contents.value = await api.locationContents(
      selectedIds.value.length ? selectedIds.value : undefined,
    );
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load contents";
  } finally {
    contentsBusy.value = false;
  }
}

watch(selectedIds, loadContents);

interface ContentsGroup {
  locationId: string;
  name: string;
  code: string | null;
  rows: LocationStockRow[];
  totalValue: number;
}

// Group the flat rows by location for display, summing value per location.
const grouped = computed<ContentsGroup[]>(() => {
  const map = new Map<string, ContentsGroup>();
  for (const r of contents.value) {
    let g = map.get(r.locationId);
    if (!g) {
      g = {
        locationId: r.locationId,
        name: r.locationName,
        code: r.locationCode,
        rows: [],
        totalValue: 0,
      };
      map.set(r.locationId, g);
    }
    g.rows.push(r);
    g.totalValue += Number(r.totalValue);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
});

const form = reactive({
  id: null as string | null,
  name: "",
  code: "",
  isDefault: false,
  isReceiving: false,
  active: true,
});

function reset(): void {
  form.id = null;
  form.name = "";
  form.code = "";
  form.isDefault = false;
  form.isReceiving = false;
  form.active = true;
}

function edit(l: Location): void {
  form.id = l.id;
  form.name = l.name;
  form.code = l.code ?? "";
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
    const payload = {
      name: form.name,
      code: form.code || undefined,
      isDefault: form.isDefault,
      isReceiving: form.isReceiving,
      active: form.active,
    };
    if (form.id) await api.updateLocation(form.id, payload);
    else await api.createLocation(payload);
    reset();
    await load();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Save failed";
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="container">
    <div v-if="error" class="banner error">{{ error }}</div>

    <div class="panel" style="margin-bottom: 1rem">
      <h3 style="margin-top: 0">What's in a location</h3>
      <p class="inactive" style="font-size: 0.85rem">
        Pick one or more locations to see their contents. With none selected,
        every location is shown. Located stock only (INV &amp; quarantine).
      </p>
      <div class="toolbar" style="flex-wrap: wrap; gap: 0.5rem">
        <label
          v-for="l in locations"
          :key="l.id"
          :class="{ inactive: !l.active }"
          style="display: inline-flex; align-items: center; gap: 0.3rem; margin-right: 0.5rem"
        >
          <input
            type="checkbox"
            style="width: auto"
            :checked="selectedIds.includes(l.id)"
            @change="toggleLocation(l.id)"
          />
          {{ l.name }}
        </label>
        <button v-if="selectedIds.length" @click="selectedIds = []">Show all</button>
      </div>

      <p v-if="!contentsBusy && grouped.length === 0" class="inactive">
        No located stock in the selected location(s).
      </p>

      <div v-for="g in grouped" :key="g.locationId" style="margin-top: 1rem">
        <h4 style="margin-bottom: 0.25rem">
          {{ g.name }}<span v-if="g.code" class="inactive"> ({{ g.code }})</span>
          <span class="inactive" style="font-weight: normal; font-size: 0.85rem">
            — {{ g.rows.length }} item(s), ${{ g.totalValue.toFixed(2) }}
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
        <div class="field">
          <label>Name</label>
          <input v-model="form.name" />
        </div>
        <div class="field">
          <label>Code</label>
          <input v-model="form.code" />
        </div>
        <div class="field">
          <label>
            <input type="checkbox" v-model="form.isDefault" style="width: auto" />
            Default storage (usable stock lands here)
          </label>
        </div>
        <div class="field">
          <label>
            <input type="checkbox" v-model="form.isReceiving" style="width: auto" />
            Receiving dock (received goods quarantine here)
          </label>
        </div>
        <div class="field">
          <label><input type="checkbox" v-model="form.active" style="width: auto" /> Active</label>
        </div>
      </div>
      <div class="toolbar">
        <button class="primary" :disabled="busy || !form.name" @click="save">
          {{ form.id ? "Save" : "Add location" }}
        </button>
        <button v-if="form.id" @click="reset">Cancel</button>
      </div>
    </div>

    <div class="panel">
      <h3 style="margin-top: 0">Locations</h3>
      <p class="inactive" style="font-size: 0.85rem">
        Physical places inventory sits. Quantity is split across locations; cost
        is item-level, so moving stock between locations never changes cost.
      </p>
      <table>
        <thead>
          <tr><th>Name</th><th>Code</th><th>Role</th><th>Active</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="l in locations" :key="l.id" :class="{ inactive: !l.active }">
            <td>{{ l.name }}</td>
            <td>{{ l.code }}</td>
            <td>
              <span v-if="l.isDefault" class="badge">Default storage</span>
              <span v-if="l.isReceiving" class="badge">Receiving</span>
            </td>
            <td>{{ l.active ? "Yes" : "No" }}</td>
            <td>
              <button v-if="canManage" @click="edit(l)">Edit</button>
            </td>
          </tr>
          <tr v-if="locations.length === 0">
            <td colspan="5" class="inactive">No locations yet.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
