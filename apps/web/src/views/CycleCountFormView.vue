<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { type Location } from "@fw3/shared-types";
import { api, ApiError } from "../lib/api";

const router = useRouter();
const locations = ref<Location[]>([]);
const error = ref<string | null>(null);
const busy = ref(false);

const KIND_INDENT: Record<string, number> = { BUILDING: 0, AISLE: 1, RACK: 2, AREA: 1 };

const form = reactive({
  scopeLocationId: "",
  blind: false,
  note: "",
});

async function load(): Promise<void> {
  try {
    locations.value = await api.listLocations();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to load locations";
  }
}

async function create(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    const count = await api.createCycleCount({
      scopeLocationId: form.scopeLocationId || undefined,
      blind: form.blind,
      note: form.note || undefined,
    });
    await router.push({ name: "cycle-count-detail", params: { id: count.id } });
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Create failed";
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="container" style="max-width: 560px">
    <div class="panel">
      <h2>New cycle count</h2>
      <div v-if="error" class="banner error">{{ error }}</div>

      <div class="field">
        <label>Scope</label>
        <select v-model="form.scopeLocationId">
          <option value="">All locations</option>
          <option v-for="l in locations" :key="l.id" :value="l.id">
            {{ " ".repeat((KIND_INDENT[l.kind] ?? 0) * 3) }}{{ l.code }} — {{ l.name }}
          </option>
        </select>
        <div class="inactive" style="font-size: 0.8rem">
          A building or aisle expands to the racks/areas under it. Only located
          stock (INV &amp; quarantine) is counted.
        </div>
      </div>

      <div class="field">
        <label>
          <input type="checkbox" v-model="form.blind" style="width: auto" />
          Blind count (hide system quantities until posted)
        </label>
      </div>

      <div class="field">
        <label>Note</label>
        <input v-model="form.note" placeholder="e.g. weekly count of aisle A" />
      </div>

      <div class="toolbar">
        <button class="primary" :disabled="busy" @click="create">
          {{ busy ? "Creating…" : "Create &amp; start counting" }}
        </button>
        <button @click="router.push({ name: 'cycle-counts' })">Cancel</button>
      </div>
    </div>
  </div>
</template>
