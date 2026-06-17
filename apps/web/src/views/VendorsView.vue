<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { PERMISSIONS, type Vendor } from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const vendors = ref<Vendor[]>([]);
const error = ref<string | null>(null);
const busy = ref(false);

const form = reactive({
  id: null as string | null,
  name: "",
  code: "",
  email: "",
  isActive: true,
});

function reset(): void {
  form.id = null;
  form.name = "";
  form.code = "";
  form.email = "";
  form.isActive = true;
}

function edit(v: Vendor): void {
  form.id = v.id;
  form.name = v.name;
  form.code = v.code ?? "";
  form.email = v.email ?? "";
  form.isActive = v.isActive;
}

async function load(): Promise<void> {
  error.value = null;
  try {
    vendors.value = await api.listVendors();
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
      email: form.email || undefined,
      isActive: form.isActive,
    };
    if (form.id) await api.updateVendor(form.id, payload);
    else await api.createVendor(payload);
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

    <div v-if="auth.hasPermission(PERMISSIONS.VENDOR_MANAGE)" class="panel" style="margin-bottom: 1rem">
      <h3>{{ form.id ? "Edit vendor" : "New vendor" }}</h3>
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
          <label>Email</label>
          <input v-model="form.email" />
        </div>
        <div class="field">
          <label><input type="checkbox" v-model="form.isActive" style="width: auto" /> Active</label>
        </div>
      </div>
      <div class="toolbar">
        <button class="primary" :disabled="busy || !form.name" @click="save">
          {{ form.id ? "Save" : "Add vendor" }}
        </button>
        <button v-if="form.id" @click="reset">Cancel</button>
      </div>
    </div>

    <div class="panel">
      <h3 style="margin-top: 0">Vendors</h3>
      <table>
        <thead>
          <tr><th>Name</th><th>Code</th><th>Email</th><th>Active</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="v in vendors" :key="v.id" :class="{ inactive: !v.isActive }">
            <td>{{ v.name }}</td>
            <td>{{ v.code }}</td>
            <td>{{ v.email }}</td>
            <td>{{ v.isActive ? "Yes" : "No" }}</td>
            <td>
              <button v-if="auth.hasPermission(PERMISSIONS.VENDOR_MANAGE)" @click="edit(v)">Edit</button>
            </td>
          </tr>
          <tr v-if="vendors.length === 0"><td colspan="5" class="inactive">No vendors yet.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
