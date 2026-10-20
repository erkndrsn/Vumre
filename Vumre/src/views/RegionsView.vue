<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { getRoomBoard } from '@/api/accommodation'
import { create, find, remove, update } from '@/api/collections'
import type { BoardPilgrim, FlightPoint, Region, User } from '@/types/payload'
import { flightPointLabel } from '@/utils/accommodation'

interface FormState {
  name: string
  defaultFlightPoint: number | null
  description: string
  active: boolean
}

interface RegionStats {
  total: number
  male: number
  female: number
  assigned: number
}

type StatusFilter = 'all' | 'active' | 'inactive'
type SortKey = 'count' | 'name'

const items = ref<Region[]>([])
const flightPoints = ref<FlightPoint[]>([])
const pilgrims = ref<BoardPilgrim[]>([])
const managers = ref<User[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const formError = ref('')
const editingId = ref<number | null>(null)
const showForm = ref(false)
const dialog = ref<HTMLDialogElement | null>(null)

const search = ref('')
const status = ref<StatusFilter>('active')
const onlyMissing = ref(false)
const sortKey = ref<SortKey>('count')

const num = new Intl.NumberFormat('tr-TR')

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

const emptyStats = (): RegionStats => ({ total: 0, male: 0, female: 0, assigned: 0 })

/** Arşivde olmayan umrecilerin bölge bazında sayımı (yerleşim panosu verisinden). */
const statsByRegion = computed(() => {
  const map = new Map<number, RegionStats>()
  for (const p of pilgrims.value) {
    if (!p.region) continue
    const s = map.get(p.region.id) ?? emptyStats()
    s.total++
    if (p.gender === 'male') s.male++
    else s.female++
    if (p.room !== null) s.assigned++
    map.set(p.region.id, s)
  }
  return map
})
const statsOf = (item: Region) => statsByRegion.value.get(item.id) ?? emptyStats()

const managersByRegion = computed(() => {
  const map = new Map<number, string[]>()
  for (const u of managers.value) {
    for (const r of u.regions ?? []) {
      const id = typeof r === 'object' ? r.id : r
      map.set(id, [...(map.get(id) ?? []), u.name || u.username])
    }
  }
  return map
})
const managersOf = (item: Region) => managersByRegion.value.get(item.id) ?? []

const isActive = (item: Region) => item.active !== false
/** Aktif bölgede uçuş noktası ya da sorumlu yönetici eksikse uyarı gösterilir. */
const missingOf = (item: Region) =>
  isActive(item)
    ? { flightPoint: !flightPointOf(item), manager: !managersOf(item).length }
    : { flightPoint: false, manager: false }
const hasMissing = (item: Region) => {
  const m = missingOf(item)
  return m.flightPoint || m.manager
}

const percent = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}%` : '0%'

const summary = computed(() => {
  const active = items.value.filter(isActive)
  const inRegion = pilgrims.value.filter((p) => p.region)
  return {
    regions: items.value.length,
    active: active.length,
    inactive: items.value.length - active.length,
    pilgrims: inRegion.length,
    noRegion: pilgrims.value.length - inRegion.length,
    assigned: inRegion.filter((p) => p.room !== null).length,
    missing: active.filter(hasMissing).length,
    noFlightPoint: active.filter((r) => missingOf(r).flightPoint).length,
    noManager: active.filter((r) => missingOf(r).manager).length,
  }
})

const visibleItems = computed(() => {
  const term = search.value.trim().toLocaleLowerCase('tr')
  const list = items.value.filter(
    (r) =>
      (status.value === 'all' || (status.value === 'active') === isActive(r)) &&
      (!onlyMissing.value || hasMissing(r)) &&
      (!term ||
        r.name.toLocaleLowerCase('tr').includes(term) ||
        (flightPointLabel(flightPointOf(r)) ?? '').toLocaleLowerCase('tr').includes(term) ||
        managersOf(r).some((m) => m.toLocaleLowerCase('tr').includes(term))),
  )
  return list.sort((a, b) =>
    sortKey.value === 'count'
      ? statsOf(b).total - statsOf(a).total || a.name.localeCompare(b.name, 'tr')
      : a.name.localeCompare(b.name, 'tr'),
  )
})

function showMissing() {
  status.value = 'active'
  onlyMissing.value = true
}

function clearFilters() {
  search.value = ''
  status.value = 'all'
  onlyMissing.value = false
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [res, points, board, users] = await Promise.all([
      find<Region>('regions', { limit: 0, sort: 'name' }),
      find<FlightPoint>('flight-points', { limit: 0, sort: 'name' }),
      getRoomBoard(),
      find<User>('users', { limit: 0, depth: 0, where: { role: { equals: 'regionManager' } } }),
    ])
    items.value = res.docs
    flightPoints.value = points.docs
    pilgrims.value = board.pilgrims
    managers.value = users.docs
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Bölgeler yüklenemedi.'
  } finally {
    loading.value = false
  }
}

watch(showForm, (open) => {
  if (open) {
    formError.value = ''
    dialog.value?.showModal()
  } else {
    dialog.value?.close()
  }
})

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
    active: isActive(item),
  })
  editingId.value = item.id
  showForm.value = true
}

async function save() {
  saving.value = true
  formError.value = ''
  try {
    if (editingId.value) await update<Region>('regions', editingId.value, { ...form })
    else await create<Region>('regions', { ...form })
    showForm.value = false
    await load()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'Kaydedilemedi.'
  } finally {
    saving.value = false
  }
}

async function toggleActive(item: Region) {
  const next = !isActive(item)
  if (
    !next &&
    !confirm(
      `"${item.name}" pasife alınsın mı? Yeni umreci kaydında ve bölge yöneticisi atamasında seçilemez; mevcut kayıtlar korunur.`,
    )
  ) {
    return
  }
  error.value = ''
  try {
    await update<Region>('regions', item.id, { active: next })
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Güncellenemedi.'
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
      <div>
        <h1>Bölgeler</h1>
        <p class="muted subtitle">
          Umrecilerin kayıt bölgeleri; varsayılan uçuş noktası ve sorumlu yöneticileriyle.
        </p>
      </div>
      <button class="btn btn-primary" @click="openCreate">Yeni bölge</button>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

    <div class="tiles">
      <div class="card tile">
        <span class="muted">Aktif bölge</span>
        <strong class="value"
          >{{ num.format(summary.active) }}<small class="muted">
            / {{ num.format(summary.regions) }}</small
          ></strong
        >
        <span class="muted small">{{ num.format(summary.inactive) }} pasif</span>
      </div>
      <div class="card tile">
        <span class="muted">Bölgelerdeki umreci</span>
        <strong class="value">{{ num.format(summary.pilgrims) }}</strong>
        <span class="small" :class="summary.noRegion ? 'warn-text' : 'muted'">
          {{
            summary.noRegion
              ? `${num.format(summary.noRegion)} umrecinin bölgesi yok`
              : 'Herkesin bölgesi belli'
          }}
        </span>
      </div>
      <div class="card tile">
        <span class="muted">Odaya yerleşen</span>
        <strong class="value">{{ percent(summary.assigned, summary.pilgrims) }}</strong>
        <span class="track" aria-hidden="true">
          <span class="fill" :style="{ width: percent(summary.assigned, summary.pilgrims) }" />
        </span>
        <span class="muted small"
          >{{ num.format(summary.assigned) }} / {{ num.format(summary.pilgrims) }} umreci</span
        >
      </div>
      <button
        type="button"
        class="card tile tile-link"
        :class="{ 'tile-warn': summary.missing }"
        :disabled="!summary.missing"
        @click="showMissing"
      >
        <span class="muted">Eksik bilgili bölge</span>
        <strong class="value" :class="{ 'warn-text': summary.missing }">{{
          num.format(summary.missing)
        }}</strong>
        <span class="muted small">
          {{ num.format(summary.noFlightPoint) }} uçuş noktası yok ·
          {{ num.format(summary.noManager) }} sorumlusuz
        </span>
      </button>
    </div>

    <div class="toolbar">
      <input
        v-model="search"
        type="search"
        class="search"
        placeholder="Bölge, uçuş noktası veya yönetici ara…"
        aria-label="Bölge ara"
      />
      <div class="segmented" role="group" aria-label="Duruma göre filtrele">
        <button
          v-for="opt in [
            { key: 'active', label: 'Aktif' },
            { key: 'inactive', label: 'Pasif' },
            { key: 'all', label: 'Tümü' },
          ] as const"
          :key="opt.key"
          type="button"
          :class="{ on: status === opt.key }"
          :aria-pressed="status === opt.key"
          @click="status = opt.key"
        >
          {{ opt.label }}
        </button>
      </div>
      <label class="check-row">
        <input v-model="onlyMissing" type="checkbox" />
        <span>Yalnızca eksik bilgisi olanlar</span>
      </label>
      <select v-model="sortKey" class="sort" aria-label="Sıralama">
        <option value="count">Umreci sayısına göre</option>
        <option value="name">Ada göre</option>
      </select>
    </div>

    <p v-if="loading && !items.length" class="card empty-state">Yükleniyor…</p>
    <div v-else-if="!items.length" class="card empty-state">
      <p>Henüz bölge tanımlanmadı.</p>
      <button class="btn btn-primary" @click="openCreate">İlk bölgeyi ekle</button>
    </div>
    <div v-else-if="!visibleItems.length" class="card empty-state">
      <p>Filtreye uyan bölge yok.</p>
      <button class="btn btn-secondary" @click="clearFilters">Filtreleri temizle</button>
    </div>

    <div v-else class="region-grid">
      <article
        v-for="item in visibleItems"
        :key="item.id"
        class="card region"
        :class="{ inactive: !isActive(item) }"
      >
        <header class="region-head">
          <h2>{{ item.name }}</h2>
          <span v-if="!isActive(item)" class="badge">Pasif</span>
          <button
            type="button"
            class="btn btn-secondary btn-sm edit"
            :aria-label="`${item.name} bölgesini düzenle`"
            @click="openEdit(item)"
          >
            Düzenle
          </button>
        </header>

        <div class="count">
          <strong>{{ num.format(statsOf(item).total) }}</strong>
          <span class="muted">umreci</span>
          <span v-if="statsOf(item).total" class="muted gender-split">
            {{ num.format(statsOf(item).male) }} E · {{ num.format(statsOf(item).female) }} K
          </span>
        </div>

        <div v-if="statsOf(item).total" class="placement">
          <span class="track" aria-hidden="true">
            <span
              class="fill"
              :style="{ width: percent(statsOf(item).assigned, statsOf(item).total) }"
            />
          </span>
          <span class="muted small"
            >{{ num.format(statsOf(item).assigned) }} odaya yerleşti<template
              v-if="statsOf(item).total - statsOf(item).assigned"
            >
              · {{ num.format(statsOf(item).total - statsOf(item).assigned) }} odasız</template
            ></span
          >
        </div>

        <dl class="facts">
          <div>
            <dt>Uçuş noktası</dt>
            <dd>
              <template v-if="flightPointOf(item)">{{
                flightPointLabel(flightPointOf(item))
              }}</template>
              <button
                v-else-if="missingOf(item).flightPoint"
                type="button"
                class="badge badge-warning as-button"
                @click="openEdit(item)"
              >
                Seçilmedi
              </button>
              <span v-else class="muted">—</span>
            </dd>
          </div>
          <div>
            <dt>Sorumlu</dt>
            <dd>
              <template v-if="managersOf(item).length">{{ managersOf(item).join(', ') }}</template>
              <RouterLink
                v-else-if="missingOf(item).manager"
                :to="{ name: 'region-managers' }"
                class="badge badge-warning"
                >Atanmadı</RouterLink
              >
              <span v-else class="muted">—</span>
            </dd>
          </div>
        </dl>

        <p v-if="item.description" class="description muted" :title="item.description">
          {{ item.description }}
        </p>

        <footer class="region-actions">
          <RouterLink
            v-if="statsOf(item).total"
            :to="{ name: 'pilgrims-by-region', query: { region: String(item.id) } }"
            class="btn btn-secondary btn-sm"
            >Umrecileri gör</RouterLink
          >
          <span class="spacer" />
          <button type="button" class="btn btn-secondary btn-sm" @click="toggleActive(item)">
            {{ isActive(item) ? 'Pasife al' : 'Aktif et' }}
          </button>
          <button
            v-if="!statsOf(item).total"
            type="button"
            class="btn btn-danger btn-sm"
            @click="destroy(item)"
          >
            Sil
          </button>
        </footer>
      </article>
    </div>

    <dialog
      ref="dialog"
      class="card modal"
      aria-labelledby="region-form-title"
      @close="showForm = false"
      @click.self="showForm = false"
    >
      <form class="form" @submit.prevent="save">
        <h2 id="region-form-title">{{ editingId ? 'Bölgeyi düzenle' : 'Yeni bölge' }}</h2>
        <div v-if="formError" class="alert alert-error" role="alert">{{ formError }}</div>
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
          </label>
          <p class="muted hint span-all">
            Uçuş noktası yeni umrecilere varsayılan olarak atanır. Bölgede havalimanı yoksa en
            yakın nokta seçilir (ör. Aydın → İzmir).
            <RouterLink v-if="!flightPoints.length" :to="{ name: 'flight-points' }"
              >Uçuş noktası ekle</RouterLink
            >
          </p>
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
    </dialog>
  </section>
</template>

<style scoped>
.subtitle {
  margin-top: 0.25rem;
  font-size: 0.875rem;
}

.alert {
  margin-bottom: 1rem;
}

.small {
  font-size: 0.8125rem;
}

.warn-text {
  color: var(--color-warning);
}

/* Özet kutuları (Panel ile aynı görünüm) */
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.tile {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 1rem 1.25rem;
  color: inherit;
  text-align: left;
  font: inherit;
}

button.tile {
  cursor: pointer;
}

button.tile:disabled {
  cursor: default;
}

.tile-link:not(:disabled):hover {
  border-color: var(--color-primary);
}

.tile-warn {
  border-color: var(--color-warning);
}

.value {
  font-size: 1.75rem;
  line-height: 1.2;
  color: var(--color-heading);
  font-variant-numeric: tabular-nums;
}

.value small {
  font-size: 1rem;
  font-weight: 400;
}

.track {
  display: block;
  height: 0.375rem;
  border-radius: 999px;
  background: var(--color-hover);
  overflow: hidden;
}

.fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-primary);
}

/* Araç çubuğu */
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  margin-bottom: 1rem;
}

.toolbar input[type='search'],
.toolbar select {
  padding: 0.45rem 0.75rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  font: inherit;
  font-size: 0.875rem;
  color: var(--color-text);
}

.search {
  flex: 1 1 240px;
  min-width: 0;
}

.sort {
  margin-left: auto;
}

.segmented {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--color-surface);
}

.segmented button {
  border: 0;
  background: transparent;
  color: var(--color-text);
  padding: 0.4rem 0.75rem;
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
}

.segmented button + button {
  border-left: 1px solid var(--color-border);
}

.segmented button.on {
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-weight: 600;
}

.check-row {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.875rem;
  cursor: pointer;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

/* Bölge kartları */
.region-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1rem;
}

.region {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding: 1.125rem 1.25rem;
}

.region.inactive {
  background: var(--color-background);
  box-shadow: none;
}

.region.inactive .count strong,
.region.inactive h2 {
  color: var(--color-muted);
}

.region-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.region-head h2 {
  font-size: 1.0625rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.region-head .edit {
  margin-left: auto;
}

.count {
  display: flex;
  align-items: baseline;
  gap: 0.375rem;
  flex-wrap: wrap;
}

.count strong {
  font-size: 1.5rem;
  line-height: 1;
  color: var(--color-heading);
  font-variant-numeric: tabular-nums;
}

.gender-split {
  margin-left: auto;
  font-size: 0.8125rem;
}

.placement {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.facts {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border);
  font-size: 0.875rem;
}

.facts div {
  display: grid;
  grid-template-columns: 6.5rem 1fr;
  align-items: center;
  gap: 0.5rem;
}

.facts dt {
  color: var(--color-muted);
}

.facts dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.facts .badge {
  text-decoration: none;
}

.as-button {
  border: 0;
  font: inherit;
  font-size: 0.8125rem;
  cursor: pointer;
}

.description {
  margin: 0;
  font-size: 0.8125rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.region-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: auto;
  padding-top: 0.25rem;
}

.region-actions .spacer {
  flex: 1;
}

/* Form penceresi */
.modal {
  /* Genel `margin: 0` sıfırlaması dialog'un ortalanmasını bozar. */
  margin: auto;
  width: min(560px, calc(100vw - 2rem));
  max-height: calc(100vh - 2rem);
  max-height: calc(100dvh - 2rem);
  overflow: auto;
  padding: 0;
  color: var(--color-text);
}

/* Dolgu formda: dialog'un kendisine tıklama yalnızca backdrop'ta olsun */
.modal > form {
  padding: 1.5rem;
}

.modal::backdrop {
  background: rgb(0 0 0 / 0.45);
}

.modal h2 {
  font-size: 1.125rem;
}

.hint {
  margin: -0.25rem 0 0;
  font-size: 0.8125rem;
}

@media (max-width: 640px) {
  .sort {
    margin-left: 0;
  }

  .search {
    flex-basis: 100%;
  }
}
</style>
