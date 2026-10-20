<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { find } from '@/api/collections'
import { useAuthStore } from '@/stores/auth'
import type { Gender, Pilgrim, Region, User } from '@/types/payload'
import { GENDER_LABELS } from '@/utils/accommodation'
import { ageOn, isInfant } from '@/utils/childPricing'

/**
 * Sol listedeki bölge: sayımlar arşivde olmayan umrecilerden. Bebekler (0-1 yaş) kontenjan
 * tutmadığı için kişi, cinsiyet ve yerleşim sayılarına girmez; `infants` içinde ayrıca sayılır.
 */
interface RegionEntry {
  key: string
  id: number | null
  name: string
  total: number
  male: number
  female: number
  assigned: number
  infants: number
  own: boolean
}

const NO_REGION = 'none'
const ALL = 'all'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const items = ref<Pilgrim[]>([])
const regions = ref<Region[]>([])
const loading = ref(false)
const error = ref('')
// Admin her bölgenin yöneticilerini görür: bölge id → yönetici adları.
const managersByRegion = ref<Record<string, string[]>>({})

const search = ref('')
const genderFilter = ref<Gender | ''>('')
// Bölgeler ekranından "Umrecileri gör" ile gelindiğinde bölge seçili açılır (?region=3).
const selected = ref<string>(
  typeof route.query.region === 'string' && route.query.region ? route.query.region : '',
)

const regionOf = (p: Pilgrim) => (p.region && typeof p.region === 'object' ? p.region : null)
const roomNumberOf = (p: Pilgrim) =>
  p.room && typeof p.room === 'object' ? p.room.roomNumber : null
const isOwn = (id: number | null) => id !== null && auth.managedRegionIds.includes(id)

function tally(entry: RegionEntry, p: Pilgrim) {
  if (isInfant(p.birthDate)) {
    entry.infants++
    return
  }
  entry.total++
  entry[p.gender]++
  if (p.room) entry.assigned++
}

const entries = computed<RegionEntry[]>(() => {
  const map = new Map<string, RegionEntry>()
  // Umrecisi olmayan aktif bölgeler de listede görünür (yeni kayıt için seçilebilsin).
  for (const r of regions.value) {
    if (r.active === false) continue
    map.set(String(r.id), {
      key: String(r.id),
      id: r.id,
      name: r.name,
      total: 0,
      male: 0,
      female: 0,
      assigned: 0,
      infants: 0,
      own: isOwn(r.id),
    })
  }
  for (const p of items.value) {
    const region = regionOf(p)
    const key = region ? String(region.id) : NO_REGION
    let entry = map.get(key)
    if (!entry) {
      entry = {
        key,
        id: region?.id ?? null,
        name: region?.name ?? 'Bölgesi yok',
        total: 0,
        male: 0,
        female: 0,
        assigned: 0,
        infants: 0,
        own: isOwn(region?.id ?? null),
      }
      map.set(key, entry)
    }
    tally(entry, p)
  }
  // Bölge yöneticisinin kendi bölgeleri üstte; sonra ada göre, bölgesizler en sonda.
  return [...map.values()].sort(
    (a, b) =>
      Number(a.key === NO_REGION) - Number(b.key === NO_REGION) ||
      Number(b.own) - Number(a.own) ||
      a.name.localeCompare(b.name, 'tr'),
  )
})

const allEntry = computed<RegionEntry>(() => {
  const entry: RegionEntry = {
    key: ALL,
    id: null,
    name: 'Tüm bölgeler',
    total: 0,
    male: 0,
    female: 0,
    assigned: 0,
    infants: 0,
    own: false,
  }
  for (const p of items.value) tally(entry, p)
  return entry
})

const ownEntries = computed(() => entries.value.filter((e) => e.own))

// Bölge yöneticisinin listesi kendi bölgeleriyle başlar; "Tüm bölgeler" onlardan sonra gelir.
const navEntries = computed(() =>
  ownEntries.value.length
    ? [...ownEntries.value, allEntry.value, ...entries.value.filter((e) => !e.own)]
    : [allEntry.value, ...entries.value],
)

// Seçim yoksa bölge yöneticisi listedeki ilk kendi bölgesini görür, admin tüm bölgeleri.
const current = computed(
  () =>
    entries.value.find((e) => e.key === selected.value) ??
    (selected.value === ALL ? undefined : ownEntries.value[0]) ??
    allEntry.value,
)
const showRegionColumn = computed(() => current.value.key === ALL)
const canAddHere = computed(() => current.value.id !== null && auth.canEditRegion(current.value.id))
const readOnly = computed(() => current.value.id !== null && !auth.canEditRegion(current.value.id))

const rows = computed(() => {
  const term = search.value.trim().toLocaleLowerCase('tr')
  const key = current.value.key
  return items.value.filter((p) => {
    if (key !== ALL && String(regionOf(p)?.id ?? NO_REGION) !== key) return false
    if (genderFilter.value && p.gender !== genderFilter.value) return false
    if (!term) return true
    return [p.fullName, p.phone, roomNumberOf(p)].some((v) =>
      (v ?? '').toLocaleLowerCase('tr').includes(term),
    )
  })
})

// Kimsenin telefonu girilmemişse sütun yer kaplamasın.
const showPhoneColumn = computed(() => rows.value.some((p) => p.phone))

const percent = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}%` : '0%'

function select(key: string) {
  selected.value = key
}

// Seçili bölge adreste tutulur; sayfa yenilenince ya da paylaşılınca aynı bölge açılır.
// Bölge yöneticisinin "Tüm bölgeler" seçimi de yazılır, yoksa yenileyince kendi bölgesine döner.
watch(selected, (key) => {
  const query = { ...route.query }
  if (key && (key !== ALL || ownEntries.value.length)) query.region = key
  else delete query.region
  router.replace({ query })
})

function openPilgrim(p: Pilgrim) {
  router.push({ name: 'pilgrim-edit', params: { id: p.id } })
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    // Bölgeler umrecilerle birlikte gelir; yöneticinin açılış bölgesi ikisine de bağlı.
    const [res, regionRes] = await Promise.all([
      find<Pilgrim>('pilgrims', {
        limit: 0,
        depth: 1,
        sort: 'fullName',
        where: { archived: { not_equals: true } },
      }),
      find<Region>('regions', { limit: 0, sort: 'name' }),
    ])
    items.value = res.docs
    regions.value = regionRes.docs
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Umreciler yüklenemedi.'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (auth.isAdmin) {
    find<User>('users', { limit: 0, depth: 0, where: { role: { equals: 'regionManager' } } })
      .then((res) => {
        const map: Record<string, string[]> = {}
        for (const u of res.docs) {
          for (const r of u.regions ?? []) {
            ;(map[String(typeof r === 'object' ? r.id : r)] ??= []).push(u.name || u.username)
          }
        }
        managersByRegion.value = map
      })
      .catch(() => undefined)
  }
  await load()
})
</script>

<template>
  <section>
    <div class="page-header">
      <h1>Bölge Listesi</h1>
      <RouterLink
        :to="{
          name: 'pilgrim-new',
          query: canAddHere ? { region: String(current.id) } : {},
        }"
        class="btn btn-primary"
        >Yeni umreci{{ canAddHere ? ` · ${current.name}` : '' }}</RouterLink
      >
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

    <p v-if="loading && !items.length" class="card empty-state">Yükleniyor…</p>
    <div v-else class="layout">
      <!-- Bölge seçimi: geniş ekranda dikey liste, dar ekranda açılır liste -->
      <nav class="card region-nav" aria-label="Bölgeler">
        <button
          v-for="e in navEntries"
          :key="e.key"
          type="button"
          class="region-item"
          :class="{ on: current.key === e.key, empty: !e.total && !e.infants, all: e.key === ALL }"
          :aria-current="current.key === e.key ? 'true' : undefined"
          @click="select(e.key)"
        >
          <span class="region-name">
            {{ e.name }}
            <i v-if="e.own" class="own-dot" title="Sorumlu olduğunuz bölge" />
          </span>
          <span
            class="region-count"
            :title="e.infants ? `${e.total} kişi + ${e.infants} bebek` : undefined"
            >{{ e.total }}<template v-if="e.infants"> + {{ e.infants }}</template></span
          >
        </button>
      </nav>
      <label class="region-select">
        <span class="sr-only">Bölge</span>
        <select :value="current.key" @change="select(($event.target as HTMLSelectElement).value)">
          <option v-for="e in navEntries" :key="e.key" :value="e.key">
            {{ e.name }} ({{ e.total }}{{ e.infants ? ` + ${e.infants} bebek` : '' }}){{
              e.own ? ' ★' : ''
            }}
          </option>
        </select>
      </label>

      <div class="card panel">
        <header class="panel-head">
          <div class="title">
            <h2>{{ current.name }}</h2>
            <span v-if="readOnly" class="badge" title="Sorumlu olduğunuz bölgelerden biri değil"
              >Yalnızca görüntüleme</span
            >
            <span v-else-if="current.own" class="badge badge-success">Sorumlu olduğunuz bölge</span>
          </div>
          <dl class="stats">
            <div>
              <dt>Kişi</dt>
              <dd>
                {{ current.total }}
                <span v-if="current.infants" class="muted infants"
                  >+ {{ current.infants }} bebek</span
                >
              </dd>
            </div>
            <div>
              <dt>Erkek / Kadın</dt>
              <dd>{{ current.male }} / {{ current.female }}</dd>
            </div>
            <div class="placement">
              <dt>Odaya yerleşen</dt>
              <dd>
                {{ current.assigned }}
                <span class="muted">/ {{ current.total }}</span>
                <span class="track" aria-hidden="true">
                  <span class="fill" :style="{ width: percent(current.assigned, current.total) }" />
                </span>
              </dd>
            </div>
            <div v-if="current.id !== null && managersByRegion[current.key]">
              <dt>Yönetici</dt>
              <dd class="managers">{{ managersByRegion[current.key]?.join(', ') }}</dd>
            </div>
          </dl>
        </header>

        <div class="filters">
          <input
            v-model="search"
            type="search"
            placeholder="İsim, telefon veya oda no ara…"
            aria-label="Umreci ara"
          />
          <div class="segmented" role="group" aria-label="Cinsiyet">
            <button
              v-for="opt in [
                { key: '', label: 'Tümü' },
                { key: 'male', label: 'Erkek' },
                { key: 'female', label: 'Kadın' },
              ] as const"
              :key="opt.key"
              type="button"
              :class="{ on: genderFilter === opt.key }"
              :aria-pressed="genderFilter === opt.key"
              @click="genderFilter = opt.key"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>

        <p v-if="!rows.length" class="empty-state">
          {{
            current.total || current.infants
              ? 'Aramaya uyan kişi yok.'
              : 'Bu bölgede henüz umreci yok.'
          }}
        </p>
        <div v-else class="table-wrap">
          <table class="table pilgrims">
            <thead>
              <tr>
                <th>Ad Soyad</th>
                <th v-if="showRegionColumn">Bölge</th>
                <th class="num">Yaş</th>
                <th v-if="showPhoneColumn">Telefon</th>
                <th>Oda</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in rows"
                :key="p.id"
                class="row-link"
                :class="{ infant: isInfant(p.birthDate) }"
                @click="openPilgrim(p)"
              >
                <td>
                  <span class="person">
                    <span class="gender" :class="p.gender" :title="GENDER_LABELS[p.gender]">{{
                      p.gender === 'male' ? 'E' : 'K'
                    }}</span>
                    <RouterLink
                      :to="{ name: 'pilgrim-edit', params: { id: p.id } }"
                      class="name"
                      @click.stop
                      >{{ p.fullName }}</RouterLink
                    >
                  </span>
                </td>
                <td v-if="showRegionColumn" class="muted">{{ regionOf(p)?.name ?? '—' }}</td>
                <td class="num">
                  <span v-if="isInfant(p.birthDate)" class="badge badge-infant">Bebek</span>
                  {{ ageOn(p.birthDate) ?? '–' }}
                </td>
                <td v-if="showPhoneColumn">
                  <a v-if="p.phone" :href="`tel:${p.phone}`" class="phone" @click.stop>{{
                    p.phone
                  }}</a>
                  <span v-else class="muted">–</span>
                </td>
                <td>
                  <span v-if="roomNumberOf(p)" class="room-chip">{{ roomNumberOf(p) }}</span>
                  <span v-else class="room-chip none">Odasız</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p
          v-if="rows.length && rows.length !== current.total + current.infants"
          class="muted result-count"
        >
          {{ rows.length }} / {{ current.total + current.infants }} kişi gösteriliyor
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.alert {
  margin-bottom: 1rem;
}

.layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}

/* Bölge listesi */
.region-nav {
  position: sticky;
  top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0.5rem;
  max-height: calc(100vh - 2rem);
  max-height: calc(100dvh - 2rem);
  overflow-y: auto;
}

.region-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.625rem;
  border: 0;
  border-radius: var(--radius);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: 0.9375rem;
  text-align: left;
  cursor: pointer;
}

.region-item:hover {
  background: var(--color-hover);
}

.region-item.on {
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-weight: 600;
}

/* "Tüm bölgeler" kendi bölgelerini diğerlerinden ayırır (yöneticide listenin ortasında). */
.region-item.all {
  margin-block: 0.25rem;
  border-block: 1px solid var(--color-border);
  border-radius: 0;
}

.region-item.all:first-child {
  margin-top: 0;
  border-top: 0;
}

.region-item.empty .region-count {
  opacity: 0.5;
}

.region-name {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
}

.own-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--color-success);
  flex: none;
}

.region-count {
  min-width: 1.75rem;
  padding: 0.0625rem 0.4rem;
  border-radius: 999px;
  background: var(--color-hover);
  color: var(--color-muted);
  font-size: 0.8125rem;
  font-weight: 500;
  text-align: center;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.region-item.on .region-count {
  background: var(--color-surface);
  color: var(--color-primary);
}

.region-select {
  display: none;
}

.region-select select {
  width: 100%;
  padding: 0.625rem 0.75rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  font: inherit;
  color: var(--color-text);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* Seçili bölge paneli */
.panel {
  padding: 1.25rem;
}

.panel-head {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--color-border);
}

.title {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  flex-wrap: wrap;
}

.title h2 {
  font-size: 1.25rem;
}

.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 2rem;
  margin: 0;
}

.stats dt {
  color: var(--color-muted);
  font-size: 0.8125rem;
}

.stats dd {
  margin: 0.125rem 0 0;
  color: var(--color-heading);
  font-size: 1.125rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.stats dd .muted {
  font-weight: 400;
  font-size: 0.9375rem;
}

.stats .managers {
  font-size: 0.9375rem;
  font-weight: 500;
}

.placement dd {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.track {
  display: inline-block;
  width: 5rem;
  height: 0.375rem;
  margin-left: 0.375rem;
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

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  align-items: center;
  padding: 1rem 0 0.75rem;
}

.filters input[type='search'] {
  flex: 1 1 220px;
  min-width: 0;
  padding: 0.45rem 0.75rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  font: inherit;
  font-size: 0.875rem;
  color: var(--color-text);
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

/* Umreci tablosu */
.pilgrims td {
  padding-block: 0.5rem;
}

.row-link {
  cursor: pointer;
}

.row-link:hover td {
  background: var(--color-hover);
}

.person {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.name {
  color: var(--color-heading);
  font-weight: 500;
  text-decoration: none;
}

.row-link:hover .name {
  color: var(--color-primary);
}

.gender {
  display: inline-grid;
  place-items: center;
  width: 1.375rem;
  height: 1.375rem;
  border-radius: 50%;
  font-size: 0.6875rem;
  font-weight: 700;
  flex: none;
}

.gender.male {
  background: var(--color-primary-soft);
  color: var(--color-primary);
}

/* Oda Yerleşimi ile aynı renkler */
.gender.female {
  background: var(--color-warning-soft);
  color: var(--color-warning);
}

.phone {
  color: inherit;
  text-decoration: none;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.phone:hover {
  color: var(--color-primary);
}

.room-chip {
  display: inline-block;
  padding: 0.0625rem 0.5rem;
  border-radius: 999px;
  background: var(--color-success-soft);
  color: var(--color-success);
  font-size: 0.8125rem;
  font-weight: 600;
  white-space: nowrap;
}

.room-chip.none {
  background: var(--color-hover);
  color: var(--color-muted);
  font-weight: 500;
}

.result-count {
  margin: 0.75rem 0 0;
  font-size: 0.8125rem;
}

.infants {
  font-size: 0.8125rem;
  font-weight: 400;
}

/* Bebekler (0-1 yaş) yatak tutmaz; Umreciler listesindeki gibi ayırt edilsin. */
tr.infant td {
  background: var(--color-primary-soft);
}

.badge-infant {
  margin-right: 0.375rem;
  background: var(--color-primary);
  color: var(--color-on-primary);
}

@media (max-width: 800px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .region-nav {
    display: none;
  }

  .region-select {
    display: block;
  }

  .panel {
    padding: 1rem;
  }
}
</style>
