<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { type Customer, PERMISSIONS } from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const customers = ref<Customer[]>([]);
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

function edit(c: Customer): void {
  form.id = c.id;
  form.name = c.name;
  form.code = c.code ?? "";
  form.email = c.email ?? "";
  form.isActive = c.isActive;
}

async function load(): Promise<void> {
  error.value = null;
  try {
    customers.value = await api.listCustomers();
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
    if (form.id) await api.updateCustomer(form.id, payload);
    else await api.createCustomer(payload);
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

    <div v-if="auth.hasPermission(PERMISSIONS.CUSTOMER_MANAGE)" class="panel" style="margin-bottom: 1rem">
      <h3>{{ form.id ? "Edit customer" : "New customer" }}</h3>
      <div class="grid-2">
        <div class="field"><label>Name</label><input v-model="form.name" /></div>
        <div class="field"><label>Code</label><input v-model="form.code" /></div>
        <div class="field"><label>Email</label><input v-model="form.email" /></div>
        <div class="field">
          <label><input type="checkbox" v-model="form.isActive" style="width: auto" /> Active</label>
        </div>
      </div>
      <div class="toolbar">
        <button class="primary" :disabled="busy || !form.name" @click="save">
          {{ form.id ? "Save" : "Add customer" }}
        </button>
        <button v-if="form.id" @click="reset">Cancel</button>
      </div>
    </div>

    <div class="panel">
      <h3 style="margin-top: 0">Customers</h3>
      <table>
        <thead>
          <tr><th>Name</th><th>Code</th><th>Email</th><th>Active</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="c in customers" :key="c.id" :class="{ inactive: !c.isActive }">
            <td>{{ c.name }}</td>
            <td>{{ c.code }}</td>
            <td>{{ c.email }}</td>
            <td>{{ c.isActive ? "Yes" : "No" }}</td>
            <td>
              <button v-if="auth.hasPermission(PERMISSIONS.CUSTOMER_MANAGE)" @click="edit(c)">Edit</button>
            </td>
          </tr>
          <tr v-if="customers.length === 0"><td colspan="5" class="inactive">No customers yet.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
