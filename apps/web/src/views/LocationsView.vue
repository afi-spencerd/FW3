<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { type Location, PERMISSIONS } from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const locations = ref<Location[]>([]);
const error = ref<string | null>(null);
const busy = ref(false);
const canManage = auth.hasPermission(PERMISSIONS.LOCATION_MANAGE);

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
