<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import {
  ADDRESS_KINDS,
  type AddressKind,
  type Customer,
  PERMISSIONS,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const customers = ref<Customer[]>([]);
const error = ref<string | null>(null);
const busy = ref(false);
const canManage = auth.hasPermission(PERMISSIONS.CUSTOMER_MANAGE);

interface AddressRow {
  kind: AddressKind;
  label: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  isPrimary: boolean;
}
interface ContactRow {
  name: string;
  title: string;
  email: string;
  phone: string;
  isPrimary: boolean;
  notes: string;
}
const blankAddress = (): AddressRow => ({
  kind: "OTHER",
  label: "",
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
  country: "",
  isPrimary: false,
});
const blankContact = (): ContactRow => ({
  name: "",
  title: "",
  email: "",
  phone: "",
  isPrimary: false,
  notes: "",
});

const form = reactive({
  id: null as string | null,
  name: "",
  code: "",
  email: "",
  phone: "",
  website: "",
  notes: "",
  isActive: true,
  addresses: [] as AddressRow[],
  contacts: [] as ContactRow[],
});

function reset(): void {
  form.id = null;
  form.name = "";
  form.code = "";
  form.email = "";
  form.phone = "";
  form.website = "";
  form.notes = "";
  form.isActive = true;
  form.addresses = [];
  form.contacts = [];
}

function edit(c: Customer): void {
  form.id = c.id;
  form.name = c.name;
  form.code = c.code ?? "";
  form.email = c.email ?? "";
  form.phone = c.phone ?? "";
  form.website = c.website ?? "";
  form.notes = c.notes ?? "";
  form.isActive = c.isActive;
  form.addresses = c.addresses.map((a) => ({
    kind: a.kind,
    label: a.label ?? "",
    line1: a.line1,
    line2: a.line2 ?? "",
    city: a.city ?? "",
    region: a.region ?? "",
    postalCode: a.postalCode ?? "",
    country: a.country ?? "",
    isPrimary: a.isPrimary,
  }));
  form.contacts = c.contacts.map((ct) => ({
    name: ct.name,
    title: ct.title ?? "",
    email: ct.email ?? "",
    phone: ct.phone ?? "",
    isPrimary: ct.isPrimary,
    notes: ct.notes ?? "",
  }));
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
      phone: form.phone || undefined,
      website: form.website || undefined,
      notes: form.notes || undefined,
      isActive: form.isActive,
      addresses: form.addresses
        .filter((a) => a.line1.trim() !== "")
        .map((a) => ({
          kind: a.kind,
          label: a.label || undefined,
          line1: a.line1,
          line2: a.line2 || undefined,
          city: a.city || undefined,
          region: a.region || undefined,
          postalCode: a.postalCode || undefined,
          country: a.country || undefined,
          isPrimary: a.isPrimary,
        })),
      contacts: form.contacts
        .filter((c) => c.name.trim() !== "")
        .map((c) => ({
          name: c.name,
          title: c.title || undefined,
          email: c.email || undefined,
          phone: c.phone || undefined,
          isPrimary: c.isPrimary,
          notes: c.notes || undefined,
        })),
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

    <div v-if="canManage" class="panel" style="margin-bottom: 1rem">
      <h3>{{ form.id ? "Edit customer" : "New customer" }}</h3>
      <div class="grid-2">
        <div class="field"><label>Name</label><input v-model="form.name" /></div>
        <div class="field"><label>Code</label><input v-model="form.code" /></div>
        <div class="field"><label>Email</label><input v-model="form.email" /></div>
        <div class="field"><label>Phone</label><input v-model="form.phone" /></div>
        <div class="field"><label>Website</label><input v-model="form.website" /></div>
        <div class="field">
          <label><input type="checkbox" v-model="form.isActive" style="width: auto" /> Active</label>
        </div>
      </div>
      <div class="field"><label>Notes</label><input v-model="form.notes" /></div>

      <h4>Addresses</h4>
      <div v-for="(a, i) in form.addresses" :key="i" class="panel" style="padding: 0.6rem; margin-bottom: 0.5rem">
        <div class="toolbar" style="flex-wrap: wrap">
          <select v-model="a.kind" style="max-width: 130px">
            <option v-for="k in ADDRESS_KINDS" :key="k" :value="k">{{ k }}</option>
          </select>
          <input v-model="a.label" placeholder="Label" style="max-width: 140px" />
          <label style="align-self: center">
            <input type="checkbox" v-model="a.isPrimary" style="width: auto" /> Primary
          </label>
          <span class="spacer" />
          <button class="danger" @click="form.addresses.splice(i, 1)">Remove</button>
        </div>
        <div class="grid-2">
          <div class="field"><label>Line 1</label><input v-model="a.line1" /></div>
          <div class="field"><label>Line 2</label><input v-model="a.line2" /></div>
          <div class="field"><label>City</label><input v-model="a.city" /></div>
          <div class="field"><label>State / region</label><input v-model="a.region" /></div>
          <div class="field"><label>Postal code</label><input v-model="a.postalCode" /></div>
          <div class="field"><label>Country</label><input v-model="a.country" /></div>
        </div>
      </div>
      <button @click="form.addresses.push(blankAddress())">+ Add address</button>

      <h4 style="margin-top: 1rem">Contacts</h4>
      <div v-for="(c, i) in form.contacts" :key="i" class="panel" style="padding: 0.6rem; margin-bottom: 0.5rem">
        <div class="grid-2">
          <div class="field"><label>Name</label><input v-model="c.name" /></div>
          <div class="field"><label>Title</label><input v-model="c.title" /></div>
          <div class="field"><label>Email</label><input v-model="c.email" /></div>
          <div class="field"><label>Phone</label><input v-model="c.phone" /></div>
          <div class="field"><label>Notes</label><input v-model="c.notes" /></div>
          <div class="field" style="align-self: end">
            <label><input type="checkbox" v-model="c.isPrimary" style="width: auto" /> Primary</label>
          </div>
        </div>
        <div class="toolbar">
          <span class="spacer" />
          <button class="danger" @click="form.contacts.splice(i, 1)">Remove</button>
        </div>
      </div>
      <button @click="form.contacts.push(blankContact())">+ Add contact</button>

      <div class="toolbar" style="margin-top: 1rem">
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
          <tr><th>Name</th><th>Code</th><th>Email</th><th>Phone</th><th class="num">Addr</th><th class="num">Contacts</th><th>Active</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="c in customers" :key="c.id" :class="{ inactive: !c.isActive }">
            <td>{{ c.name }}</td>
            <td>{{ c.code }}</td>
            <td>{{ c.email }}</td>
            <td>{{ c.phone }}</td>
            <td class="num">{{ c.addresses.length }}</td>
            <td class="num">{{ c.contacts.length }}</td>
            <td>{{ c.isActive ? "Yes" : "No" }}</td>
            <td>
              <button v-if="canManage" @click="edit(c)">Edit</button>
            </td>
          </tr>
          <tr v-if="customers.length === 0"><td colspan="8" class="inactive">No customers yet.</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
