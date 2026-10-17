<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { create, find, remove, update } from '@/api/collections'
import type { FlightPoint, Region } from '@/types/payload'
import { flightPointLabel } from '@/utils/accommodation'

interface FormState {
  name: string
  defaultFlightPoint: number | null
  description: string
  active: boolean
}

const items = ref<Region[]>([])
const flightPoints = ref<FlightPoint[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const editingId = ref<number | null>(null)
const showForm = ref(false)

const emptyForm = (): FormState => ({
  name: '',
  defaultFlightPoint: null,
  description: '',
  active: true,
})
const form = reactive<FormState>(emptyForm())

// Pasif noktalar yeni seçime kapalı; bölgenin mevcut noktası pasif olsa da listede kalır.
const flightPointOptions = computed(() =>
  flightPoints.value.filter((p) => p.active !== false || p.id === form.defaultFlightPoint),
)

const flightPointOf = (item: Region) =>
  item.defaultFlightPoint && typeof item.defaultFlightPoint === 'object'
    ? item.defaultFlightPoint
    : null

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [res, points] = await Promise.all([
      find<Region>('regions', { limit: 0, sort: 'name' }),
      find<FlightPoint>('flight-points', { limit: 0, sort: 'name' }),
    ])
    items.value = res.docs
    flightPoints.value = points.docs
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Bölgeler yüklenemedi.'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  Object.assign(form, emptyForm())
  editingId.value = null
  showForm.value = true
}

function openEdit(item: Region) {
  Object.assign(form, {
    name: item.name,
    defaultFlightPoint: flightPointOf(item)?.id ?? null,
    description: item.description ?? '',
    active: item.active !== false,
  })
  editingId.value = item.id
  showForm.value = true
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    if (editingId.value) await update<Region>('regions', editingId.value, { ...form })
    else await create<Region>('regions', { ...form })
    showForm.value = false
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Kaydedilemedi.'
  } finally {
    saving.value = false
  }
}

async function destroy(item: Region) {
  if (!confirm(`"${item.name}" bölgesi silinsin mi?`)) return
  error.value = ''
  try {
    await remove('regions', item.id)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Silinemedi.'
  }
}

onMounted(load)
</script>

<template>
  <section>
    <div class="page-header">
      <h1>Bölgeler</h1>
      <button class="btn btn-primary" @click="openCreate">Yeni bölge</button>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

    <form v-if="showForm" class="card form editor" @submit.prevent="save">
      <h2>{{ editingId ? 'Bölgeyi düzenle' : 'Yeni bölge' }}</h2>
      <div class="form-grid">
        <label class="field">
          <span>Bölge adı</span>
          <input v-model.trim="form.name" required placeholder="Ankara" />
        </label>
        <label class="field">
          <span>Uçuş noktası</span>
          <select v-model="form.defaultFlightPoint">
            <option :value="null">Seçilmedi</option>
            <option v-for="p in flightPointOptions" :key="p.id" :value="p.id">
              {{ p.name }}{{ p.airportCode ? ` (${p.airportCode})` : '' }}
            </option>
          </select>
          <small class="muted">
            Bölgede havalimanı yoksa en yakın nokta seçilir (ör. Aydın → İzmir). Yeni umrecilere
            varsayılan olarak atanır.
          </small>
        </label>
        <label class="field span-all">
          <span>Açıklama</span>
          <textarea v-model="form.description" rows="2" />
        </label>
        <label class="field field-check">
          <input v-model="form.active" type="checkbox" />
          <span>Aktif</span>
        </label>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" @click="showForm = false">Vazgeç</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Kaydediliyor…' : 'Kaydet' }}
        </button>
      </div>
    </form>

    <div class="card table-wrap">
      <p v-if="loading" class="empty-state">Yükleniyor…</p>
      <p v-else-if="!items.length" class="empty-state">Henüz bölge tanımlanmadı.</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Bölge</th>
            <th>Uçuş noktası</th>
            <th>Açıklama</th>
            <th>Durum</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in items"
            :key="item.id"
            :class="{ 'is-disabled': item.active === false }"
          >
            <td>{{ item.name }}</td>
            <td>{{ flightPointLabel(flightPointOf(item)) || '—' }}</td>
            <td>{{ item.description || '—' }}</td>
            <td>
              <span class="badge" :class="{ 'badge-success': item.active !== false }">
                {{ item.active === false ? 'Pasif' : 'Aktif' }}
              </span>
            </td>
            <td class="actions">
              <button class="btn btn-secondary btn-sm" @click="openEdit(item)">Düzenle</button>
              <button class="btn btn-danger btn-sm" @click="destroy(item)">Sil</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.alert,
.editor {
  margin-bottom: 1rem;
}

.editor h2 {
  font-size: 1.125rem;
}
</style>
