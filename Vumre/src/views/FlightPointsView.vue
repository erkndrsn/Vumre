<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { create, find, remove, update } from '@/api/collections'
import type { FlightPoint, Pilgrim, Region } from '@/types/payload'

interface FormState {
  name: string
  city: string
  airportCode: string
  isMain: boolean
  description: string
  active: boolean
}

const items = ref<FlightPoint[]>([])
const regions = ref<Region[]>([])
// Arşivde olmayan umrecilerin uçuş noktalarına göre sayısı; bilet planlaması için.
const pilgrimCounts = ref<Record<string, number>>({})
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const editingId = ref<number | null>(null)
const showForm = ref(false)

const emptyForm = (): FormState => ({
  name: '',
  city: '',
  airportCode: '',
  isMain: false,
  description: '',
  active: true,
})
const form = reactive<FormState>(emptyForm())

const mainPoint = computed(() => items.value.find((p) => p.isMain))
const unassignedCount = computed(() => pilgrimCounts.value[''] ?? 0)

function regionsOf(point: FlightPoint) {
  return regions.value
    .filter((r) => {
      const id =
        r.defaultFlightPoint && typeof r.defaultFlightPoint === 'object'
          ? r.defaultFlightPoint.id
          : r.defaultFlightPoint
      return id === point.id
    })
    .map((r) => r.name)
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [points, regionRes, pilgrims] = await Promise.all([
      find<FlightPoint>('flight-points', { limit: 0, sort: 'name' }),
      find<Region>('regions', { limit: 0, depth: 0, sort: 'name' }),
      find<Pilgrim>('pilgrims', {
        limit: 0,
        depth: 0,
        where: { archived: { not_equals: true } },
      }),
    ])
    items.value = points.docs
    regions.value = regionRes.docs
    const counts: Record<string, number> = {}
    for (const p of pilgrims.docs) {
      const id =
        p.flightPoint && typeof p.flightPoint === 'object' ? p.flightPoint.id : p.flightPoint
      const key = id ? String(id) : ''
      counts[key] = (counts[key] ?? 0) + 1
    }
    pilgrimCounts.value = counts
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Uçuş noktaları yüklenemedi.'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  Object.assign(form, emptyForm())
  editingId.value = null
  showForm.value = true
}

function openEdit(item: FlightPoint) {
  Object.assign(form, {
    name: item.name,
    city: item.city,
    airportCode: item.airportCode ?? '',
    isMain: item.isMain === true,
    description: item.description ?? '',
    active: item.active !== false,
  })
  editingId.value = item.id
  showForm.value = true
}

async function save() {
  saving.value = true
  error.value = ''
  const data = {
    ...form,
    airportCode: form.airportCode.trim() || null,
    description: form.description.trim() || null,
  }
  try {
    if (editingId.value) await update<FlightPoint>('flight-points', editingId.value, data)
    else await create<FlightPoint>('flight-points', data)
    showForm.value = false
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Kaydedilemedi.'
  } finally {
    saving.value = false
  }
}

async function destroy(item: FlightPoint) {
  if (!confirm(`"${item.name}" uçuş noktası silinsin mi?`)) return
  error.value = ''
  try {
    await remove('flight-points', item.id)
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
      <h1>Uçuş Noktaları</h1>
      <button class="btn btn-primary" @click="openCreate">Yeni uçuş noktası</button>
    </div>

    <p class="muted intro">
      Umrecilerin uçağa bineceği havalimanları. Genel uçuş ana noktadan
      <template v-if="mainPoint"
        >(<strong>{{ mainPoint.city }}</strong
        >)</template
      >
      kalkar; diğer noktalardan aktarmalı gelinir. Havalimanı olmayan bölgeler, Bölgeler ekranında
      en yakın uçuş noktasına bağlanır.
    </p>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

    <form v-if="showForm" class="card form editor" @submit.prevent="save">
      <h2>{{ editingId ? 'Uçuş noktasını düzenle' : 'Yeni uçuş noktası' }}</h2>
      <div class="form-grid">
        <label class="field">
          <span>Uçuş noktası adı</span>
          <input v-model.trim="form.name" required placeholder="İzmir Adnan Menderes Havalimanı" />
        </label>
        <label class="field">
          <span>Şehir</span>
          <input v-model.trim="form.city" required placeholder="İzmir" />
        </label>
        <label class="field">
          <span>Havalimanı kodu</span>
          <input v-model.trim="form.airportCode" maxlength="4" placeholder="ADB" class="code" />
        </label>
        <label class="field span-all">
          <span>Açıklama</span>
          <textarea v-model="form.description" rows="2" />
        </label>
        <label class="field field-check">
          <input v-model="form.isMain" type="checkbox" />
          <span>Ana uçuş noktası (genel uçuş buradan kalkar)</span>
        </label>
        <label class="field field-check">
          <input v-model="form.active" type="checkbox" />
          <span>Aktif</span>
        </label>
      </div>
      <p v-if="form.isMain && mainPoint && mainPoint.id !== editingId" class="muted">
        Kaydedince {{ mainPoint.name }} ana nokta olmaktan çıkar.
      </p>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" @click="showForm = false">Vazgeç</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Kaydediliyor…' : 'Kaydet' }}
        </button>
      </div>
    </form>

    <div class="card table-wrap">
      <p v-if="loading" class="empty-state">Yükleniyor…</p>
      <p v-else-if="!items.length" class="empty-state">Henüz uçuş noktası tanımlanmadı.</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Uçuş noktası</th>
            <th>Şehir</th>
            <th>Kod</th>
            <th>Uçuş</th>
            <th>Bağlı bölgeler</th>
            <th class="num">Umreci</th>
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
            <td>{{ item.city }}</td>
            <td>{{ item.airportCode || '—' }}</td>
            <td>
              <span v-if="item.isMain" class="badge badge-success">Ana uçuş</span>
              <span v-else class="badge">Aktarmalı</span>
            </td>
            <td>{{ regionsOf(item).join(', ') || '—' }}</td>
            <td class="num">{{ pilgrimCounts[String(item.id)] ?? 0 }}</td>
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

    <p v-if="!loading && unassignedCount" class="muted unassigned">
      {{ unassignedCount }} umrecinin uçuş noktası seçilmemiş.
    </p>
  </section>
</template>

<style scoped>
.alert,
.editor,
.intro {
  margin-bottom: 1rem;
}

.editor h2 {
  font-size: 1.125rem;
}

.code {
  text-transform: uppercase;
}

.unassigned {
  margin-top: 0.75rem;
}
</style>
