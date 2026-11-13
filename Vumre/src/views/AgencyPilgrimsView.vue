<script setup lang="ts">
// Acentenin umreci listesi: yalnızca ad, soyad, doğum tarihi, uçuş noktası, oda ve kimlik resmi.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { listAgencyPilgrims } from '@/api/agency'
import type { AgencyPilgrim } from '@/types/payload'
import { formatDate } from '@/utils/accommodation'
import { ageOn } from '@/utils/childPricing'

type IdCard = NonNullable<AgencyPilgrim['idCard']>
type RoomFilter = 'all' | 'placed' | 'unplaced'
type SortKey = 'name' | 'birthDate' | 'flightPoint' | 'room'

const NO_FLIGHT = 'none'

const items = ref<AgencyPilgrim[]>([])
const loading = ref(false)
const error = ref('')
const search = ref('')
const flightPointFilter = ref<string>('')
const roomFilter = ref<RoomFilter>('all')
const missingIdOnly = ref(false)
const sortKey = ref<SortKey>('name')
const sortDesc = ref(false)
const preview = ref<{ card: IdCard; name: string } | null>(null)

const num = new Intl.NumberFormat('tr-TR')
const fold = (s: string) => s.toLocaleLowerCase('tr').trim()
const fullName = (p: AgencyPilgrim) => `${p.firstName} ${p.lastName}`
const initials = (p: AgencyPilgrim) =>
  `${p.firstName.charAt(0)}${p.lastName.charAt(0)}`.toLocaleUpperCase('tr')
const isImage = (card: IdCard) => !!card.mimeType?.startsWith('image/')
const compareText = (a: string, b: string) =>
  a.localeCompare(b, 'tr', { numeric: true, sensitivity: 'base' })

const stats = computed(() => {
  const s = { total: items.value.length, placed: 0, withId: 0 }
  for (const p of items.value) {
    if (p.roomNumber) s.placed++
    if (p.idCard) s.withId++
  }
  return s
})

/** Uçuş noktası seçenekleri, kişi sayılarıyla; seçilmemişler en sonda. */
const flightPoints = computed(() => {
  const map = new Map<string, { key: string; name: string; count: number }>()
  for (const p of items.value) {
    const key = p.flightPoint ? String(p.flightPoint.id) : NO_FLIGHT
    const entry = map.get(key) ?? {
      key,
      name: p.flightPoint?.name ?? 'Uçuş noktası seçilmemiş',
      count: 0,
    }
    entry.count++
    map.set(key, entry)
  }
  return [...map.values()].sort(
    (a, b) =>
      Number(a.key === NO_FLIGHT) - Number(b.key === NO_FLIGHT) || compareText(a.name, b.name),
  )
})

const filtered = computed(() => {
  const q = fold(search.value)
  return items.value.filter((p) => {
    if (q && !fold(fullName(p)).includes(q) && !fold(p.roomNumber ?? '').includes(q)) return false
    if (flightPointFilter.value) {
      const key = p.flightPoint ? String(p.flightPoint.id) : NO_FLIGHT
      if (key !== flightPointFilter.value) return false
    }
    if (roomFilter.value === 'placed' && !p.roomNumber) return false
    if (roomFilter.value === 'unplaced' && p.roomNumber) return false
    if (missingIdOnly.value && p.idCard) return false
    return true
  })
})

const sorted = computed(() => {
  const dir = sortDesc.value ? -1 : 1
  const byName = (a: AgencyPilgrim, b: AgencyPilgrim) =>
    compareText(a.lastName, b.lastName) || compareText(a.firstName, b.firstName)
  // Boş değerler (tarih, nokta, oda) yön ne olursa olsun en sonda.
  const emptyLast = (a: string | null, b: string | null, cmp: () => number) =>
    !a && !b ? 0 : !a ? 1 : !b ? -1 : cmp() * dir
  return [...filtered.value].sort((a, b) => {
    let r = 0
    if (sortKey.value === 'name') r = byName(a, b) * dir
    else if (sortKey.value === 'birthDate')
      r = emptyLast(a.birthDate, b.birthDate, () => compareText(a.birthDate!, b.birthDate!))
    else if (sortKey.value === 'flightPoint')
      r = emptyLast(a.flightPoint?.name ?? null, b.flightPoint?.name ?? null, () =>
        compareText(a.flightPoint!.name, b.flightPoint!.name),
      )
    else r = emptyLast(a.roomNumber, b.roomNumber, () => compareText(a.roomNumber!, b.roomNumber!))
    return r || byName(a, b)
  })
})

const hasFilters = computed(
  () =>
    !!search.value ||
    !!flightPointFilter.value ||
    roomFilter.value !== 'all' ||
    missingIdOnly.value,
)

function clearFilters() {
  search.value = ''
  flightPointFilter.value = ''
  roomFilter.value = 'all'
  missingIdOnly.value = false
}

function sortBy(key: SortKey) {
  if (sortKey.value === key) sortDesc.value = !sortDesc.value
  else {
    sortKey.value = key
    sortDesc.value = false
  }
}

const ariaSort = (key: SortKey) =>
  sortKey.value === key ? (sortDesc.value ? 'descending' : 'ascending') : 'none'

async function load() {
  loading.value = true
  error.value = ''
  try {
    items.value = await listAgencyPilgrims()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Umreciler yüklenemedi.'
  } finally {
    loading.value = false
  }
}

/** Görseller sayfada büyütülür; PDF'ler yeni sekmede açılır. */
function open(p: AgencyPilgrim) {
  if (!p.idCard) return
  if (isImage(p.idCard)) preview.value = { card: p.idCard, name: fullName(p) }
  else window.open(p.idCard.url, '_blank', 'noopener')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') preview.value = null
}

onMounted(() => {
  load()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <section class="agency-pilgrims">
    <div class="page-header">
      <div>
        <h1>Umreciler</h1>
        <p v-if="stats.total" class="muted subtitle">
          {{ num.format(stats.total) }} umreci · {{ num.format(stats.placed) }} odaya yerleşti ·
          {{ num.format(stats.withId) }} kimlik yüklü
        </p>
      </div>
      <button class="btn btn-secondary" :disabled="loading" @click="load">
        {{ loading ? 'Yükleniyor…' : 'Yenile' }}
      </button>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

    <div class="card filters">
      <label class="search">
        <svg viewBox="0 0 20 20" aria-hidden="true" class="search-icon">
          <path
            d="M8.5 3a5.5 5.5 0 1 0 3.4 9.83l3.63 3.63a.75.75 0 1 0 1.06-1.06l-3.63-3.63A5.5 5.5 0 0 0 8.5 3Zm-4 5.5a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z"
            fill="currentColor"
          />
        </svg>
        <input
          v-model="search"
          type="search"
          placeholder="Ad, soyad veya oda no ara"
          aria-label="Ad, soyad veya oda numarası ara"
        />
      </label>

      <select v-model="flightPointFilter" class="select" aria-label="Uçuş noktasına göre filtrele">
        <option value="">Tüm uçuş noktaları</option>
        <option v-for="f in flightPoints" :key="f.key" :value="f.key">
          {{ f.name }} ({{ num.format(f.count) }})
        </option>
      </select>

      <div class="segmented-control" role="group" aria-label="Oda durumu">
        <button
          v-for="opt in [
            { key: 'all', label: 'Tümü', count: stats.total },
            { key: 'placed', label: 'Odalı', count: stats.placed },
            { key: 'unplaced', label: 'Odasız', count: stats.total - stats.placed },
          ] as const"
          :key="opt.key"
          type="button"
          :class="{ on: roomFilter === opt.key }"
          :aria-pressed="roomFilter === opt.key"
          @click="roomFilter = opt.key"
        >
          {{ opt.label }} <span class="count">{{ num.format(opt.count) }}</span>
        </button>
      </div>

      <label class="toggle">
        <input v-model="missingIdOnly" type="checkbox" />
        <span>Kimliği eksik olanlar</span>
      </label>

      <button v-if="hasFilters" type="button" class="link-button" @click="clearFilters">
        Filtreleri temizle
      </button>
    </div>

    <div class="card list">
      <p v-if="loading && !items.length" class="empty-state">Yükleniyor…</p>
      <div v-else-if="!sorted.length" class="empty-state">
        <p>{{ items.length ? 'Filtrelere uyan umreci yok.' : 'Henüz umreci kaydı yok.' }}</p>
        <button
          v-if="hasFilters"
          type="button"
          class="btn btn-secondary btn-sm"
          @click="clearFilters"
        >
          Filtreleri temizle
        </button>
      </div>
      <div v-else class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th :aria-sort="ariaSort('name')">
                <button type="button" class="sort" @click="sortBy('name')">
                  Ad Soyad<span class="arrow" :class="{ on: sortKey === 'name', desc: sortDesc }" />
                </button>
              </th>
              <th :aria-sort="ariaSort('birthDate')">
                <button type="button" class="sort" @click="sortBy('birthDate')">
                  Doğum tarihi<span
                    class="arrow"
                    :class="{ on: sortKey === 'birthDate', desc: sortDesc }"
                  />
                </button>
              </th>
              <th :aria-sort="ariaSort('flightPoint')">
                <button type="button" class="sort" @click="sortBy('flightPoint')">
                  Uçuş noktası<span
                    class="arrow"
                    :class="{ on: sortKey === 'flightPoint', desc: sortDesc }"
                  />
                </button>
              </th>
              <th :aria-sort="ariaSort('room')">
                <button type="button" class="sort" @click="sortBy('room')">
                  Oda<span class="arrow" :class="{ on: sortKey === 'room', desc: sortDesc }" />
                </button>
              </th>
              <th class="id-col">Kimlik</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in sorted" :key="p.id">
              <td>
                <div class="person">
                  <span class="avatar" aria-hidden="true">{{ initials(p) }}</span>
                  <span class="person-name">
                    {{ p.firstName }} <strong>{{ p.lastName }}</strong>
                  </span>
                </div>
              </td>
              <td class="nowrap">
                <template v-if="p.birthDate">
                  {{ formatDate(p.birthDate) }}
                  <span class="muted age">{{ ageOn(p.birthDate) }} yaş</span>
                </template>
                <span v-else class="muted">—</span>
              </td>
              <td>
                <span v-if="p.flightPoint" class="chip">
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path
                      d="M17.7 3.3a1.3 1.3 0 0 0-1.84 0L12.6 6.56 5.2 4.4 3.8 5.8l6 3.3-2.9 2.9-2.2-.3-1.1 1.1 2.7 1.5 1.5 2.7 1.1-1.1-.3-2.2 2.9-2.9 3.3 6 1.4-1.4-2.16-7.4 3.26-3.26a1.3 1.3 0 0 0 0-1.84Z"
                      fill="currentColor"
                    />
                  </svg>
                  {{ p.flightPoint.name }}
                </span>
                <span v-else class="muted small">Seçilmemiş</span>
              </td>
              <td>
                <span v-if="p.roomNumber" class="room">{{ p.roomNumber }}</span>
                <span v-else class="badge badge-warning">Odasız</span>
              </td>
              <td class="id-col">
                <button
                  v-if="p.idCard"
                  type="button"
                  class="id-thumb"
                  :aria-label="`${fullName(p)} kimlik resmini aç`"
                  @click="open(p)"
                >
                  <img
                    v-if="isImage(p.idCard)"
                    :src="p.idCard.thumbnailUrl || p.idCard.url"
                    alt=""
                    loading="lazy"
                  />
                  <span v-else class="file-icon">PDF</span>
                </button>
                <span v-else class="badge">Yok</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="sorted.length" class="list-footer muted">
        <template v-if="sorted.length !== items.length">
          {{ num.format(sorted.length) }} / {{ num.format(items.length) }} umreci gösteriliyor
        </template>
        <template v-else>{{ num.format(items.length) }} umreci</template>
      </p>
    </div>

    <div v-if="preview" class="lightbox" role="dialog" aria-modal="true" @click="preview = null">
      <img :src="preview.card.url" :alt="`${preview.name} kimlik resmi`" @click.stop />
      <div class="lightbox-bar" @click.stop>
        <span>{{ preview.name }}</span>
        <a :href="preview.card.url" target="_blank" rel="noopener" class="btn btn-secondary btn-sm"
          >Yeni sekmede aç</a
        >
        <button type="button" class="btn btn-secondary btn-sm" @click="preview = null">
          Kapat
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.agency-pilgrims {
  max-width: 1200px;
}

.subtitle {
  margin-top: 0.25rem;
  font-size: 0.9375rem;
}

.alert {
  margin-bottom: 1rem;
}

.small {
  font-size: 0.875rem;
}

.nowrap {
  white-space: nowrap;
}

/* Filtre çubuğu */
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  margin-bottom: 1rem;
}

.search {
  position: relative;
  flex: 1 1 260px;
  min-width: 0;
}

.search-icon {
  position: absolute;
  left: 0.75rem;
  top: 50%;
  width: 1rem;
  height: 1rem;
  transform: translateY(-50%);
  color: var(--color-muted);
  pointer-events: none;
}

.search input,
.select {
  width: 100%;
  height: 2.375rem;
  padding: 0 0.75rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  color: var(--color-text);
  font: inherit;
  font-size: 0.9375rem;
}

.search input {
  padding-left: 2.25rem;
}

.select {
  flex: 0 1 240px;
  width: auto;
  min-width: 180px;
}

.search input:focus-visible,
.select:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -1px;
  border-color: transparent;
}

.segmented-control {
  display: inline-flex;
  padding: 0.1875rem;
  gap: 0.125rem;
  background: var(--color-hover);
  border-radius: var(--radius);
}

.segmented-control button {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  height: 2rem;
  padding: 0 0.75rem;
  border: 0;
  border-radius: calc(var(--radius) - 2px);
  background: transparent;
  color: var(--color-muted);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
}

.segmented-control button.on {
  background: var(--color-surface);
  color: var(--color-heading);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}

.segmented-control .count {
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--color-muted);
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  cursor: pointer;
  user-select: none;
}

.link-button {
  margin-left: auto;
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-primary);
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
}

.link-button:hover {
  text-decoration: underline;
}

/* Liste */
.list {
  padding: 0;
  overflow: hidden;
}

.table-scroll {
  overflow-x: auto;
}

.table th {
  white-space: nowrap;
}

.table th:first-child,
.table td:first-child {
  padding-left: 1.25rem;
}

.table th:last-child,
.table td:last-child {
  padding-right: 1.25rem;
}

.table tbody tr:hover td {
  background: var(--color-hover);
}

.table tbody tr:last-child td {
  border-bottom: 0;
}

.sort {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.sort:hover {
  color: var(--color-heading);
}

/* Sıralama oku: seçili sütunda görünür, yönü çevrilir. */
.arrow {
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-bottom: 5px solid currentColor;
  opacity: 0;
}

.sort:hover .arrow {
  opacity: 0.35;
}

.arrow.on {
  opacity: 1 !important;
  color: var(--color-primary);
}

.arrow.on.desc {
  transform: rotate(180deg);
}

.person {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 200px;
}

.avatar {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 999px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: 0.75rem;
  font-weight: 600;
}

.person-name strong {
  font-weight: 600;
  color: var(--color-heading);
}

.age {
  display: block;
  font-size: 0.8125rem;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.1875rem 0.625rem;
  border-radius: 999px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
}

.chip svg {
  width: 0.875rem;
  height: 0.875rem;
}

.room {
  display: inline-block;
  min-width: 3rem;
  padding: 0.1875rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: center;
  color: var(--color-heading);
}

.id-col {
  width: 1%;
  white-space: nowrap;
}

.id-thumb {
  display: block;
  width: 64px;
  height: 42px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: calc(var(--radius) - 2px);
  background: var(--color-background);
  cursor: zoom-in;
  overflow: hidden;
  transition: transform 0.12s ease;
}

.id-thumb:hover {
  transform: scale(1.05);
  border-color: var(--color-primary);
}

.id-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.file-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-muted);
}

.list-footer {
  margin: 0;
  padding: 0.75rem 1.25rem;
  border-top: 1px solid var(--color-border);
  font-size: 0.875rem;
}

.empty-state .btn {
  margin-top: 0.75rem;
}

/* Kimlik büyütme */
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 1rem;
  background: rgb(0 0 0 / 0.8);
}

.lightbox img {
  max-width: 100%;
  max-height: calc(100vh - 6rem);
  max-height: calc(100dvh - 6rem);
  object-fit: contain;
  border-radius: var(--radius);
}

.lightbox-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  color: #fff;
}

@media (max-width: 720px) {
  .select {
    flex: 1 1 100%;
  }

  .segmented-control {
    flex: 1 1 100%;
  }

  .segmented-control button {
    flex: 1;
    justify-content: center;
  }

  .link-button {
    margin-left: 0;
  }
}
</style>
