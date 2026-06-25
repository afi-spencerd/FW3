<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  ADDRESS_KINDS,
  type AddressKind,
  type Customer,
  CUSTOMER_RATINGS,
  type CustomerRating,
  PAYMENT_TERMS,
  type PaymentTerms,
  PERMISSIONS,
} from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";
import { useAuthStore } from "../stores/auth";

const props = defineProps<{ id?: string }>();
const router = useRouter();
const auth = useAuthStore();
const isEdit = Boolean(props.id);
const canManage = auth.hasPermission(PERMISSIONS.CUSTOMER_MANAGE);

const error = ref<string | null>(null);
const busy = ref(false);
const loaded = ref(!isEdit);

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
  name: "",
  code: "",
  email: "",
  phone: "",
  website: "",
  taxId: "",
  paymentTerms: "" as PaymentTerms | "",
  rating: "" as CustomerRating | "",
  creditLimit: "",
  notes: "",
  isActive: true,
  addresses: [] as AddressRow[],
  contacts: [] as ContactRow[],
});

function apply(c: Customer): void {
  form.name = c.name;
  form.code = c.code ?? "";
  form.email = c.email ?? "";
  form.phone = c.phone ?? "";
  form.website = c.website ?? "";
  form.taxId = c.taxId ?? "";
  form.paymentTerms = c.paymentTerms ?? "";
  form.rating = c.rating ?? "";
  form.creditLimit = c.creditLimit ?? "";
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

onMounted(async () => {
  if (!props.id) return;
  try {
    apply(await api.getCustomer(props.id));
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load";
  } finally {
    loaded.value = true;
  }
});

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
      taxId: form.taxId || undefined,
      paymentTerms: form.paymentTerms || undefined,
      rating: form.rating || undefined,
      creditLimit: form.creditLimit.trim() || undefined,
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
    if (props.id) {
      // Blanking the field clears the limit (null = no limit); create can't send null.
      await api.updateCustomer(props.id, {
        ...payload,
        creditLimit: form.creditLimit.trim() === "" ? null : form.creditLimit,
      });
    } else {
      await api.createCustomer(payload);
    }
    await router.push({ name: "customers" });
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Save failed";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="container" style="max-width: 860px">
    <div v-if="error" class="banner error">{{ error }}</div>

    <div class="panel">
      <div class="toolbar">
        <h2 style="margin: 0">{{ isEdit ? "Edit customer" : "New customer" }}</h2>
        <span class="spacer" />
        <button @click="router.push({ name: 'customers' })">Back</button>
      </div>

      <fieldset :disabled="!canManage" style="border: none; padding: 0; margin: 0">
        <div class="grid-2">
          <div class="field"><label>Name</label><input v-model="form.name" /></div>
          <div class="field"><label>Code</label><input v-model="form.code" /></div>
          <div class="field"><label>Email</label><input v-model="form.email" /></div>
          <div class="field"><label>Phone</label><input v-model="form.phone" /></div>
          <div class="field"><label>Website</label><input v-model="form.website" /></div>
          <div class="field"><label>Tax ID</label><input v-model="form.taxId" /></div>
          <div class="field">
            <label>Payment terms</label>
            <select v-model="form.paymentTerms">
              <option value="">—</option>
              <option v-for="t in PAYMENT_TERMS" :key="t" :value="t">{{ t.replace(/_/g, " ") }}</option>
            </select>
          </div>
          <div class="field">
            <label>Rating (buy volume)</label>
            <select v-model="form.rating">
              <option value="">— unrated</option>
              <option v-for="r in CUSTOMER_RATINGS" :key="r" :value="r">{{ r }}</option>
            </select>
          </div>
          <div class="field">
            <label>Credit limit</label>
            <input v-model="form.creditLimit" inputmode="decimal" placeholder="No limit" />
            <span class="inactive" style="font-size: 0.75rem">
              Max open balance. Blank = no limit; 0 = prepay only.
            </span>
          </div>
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

        <div v-if="canManage" class="toolbar" style="margin-top: 1rem">
          <button class="primary" :disabled="busy || !form.name" @click="save">
            {{ isEdit ? "Save" : "Add customer" }}
          </button>
          <button @click="router.push({ name: 'customers' })">Cancel</button>
        </div>
      </fieldset>
    </div>
  </div>
</template>
