<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { download } from '@/api/client'
import { find } from '@/api/collections'
import type { FlightPoint, Pilgrim, Region, Where } from '@/types/payload'
import { flightPointLabel, formatMoney } from '@/utils/accommodation'
import { ageOn, isChild, isInfant } from '@/utils/childPricing'

const items = ref<Pilgrim[]>([])
const search = ref('')
const regions = ref<Region[]>([])
const regionFilter = ref<number | ''>('')
const flightPoints = ref<FlightPoint[]>([])
// 'none': uçuş noktası seçilmemiş olanlar.
const flightPointFilter = ref<number | 'none' | ''>('')
// Programı iptal edenler arşivde ayrı listelenir.
const showArchived = ref(false)
const loading = ref(false)
const error = ref('')

const infantCount = computed(() => items.value.filter((p) => isInfant(p.birthDate)).length)
const childCount = computed(() => items.value.filter((p) => isChild(p.birthDate)).length)

const exporting = ref(false)

// Her bölge ayrı sayfa; bölge filtresi seçiliyse yalnızca o bölge (sunucuda exceljs ile üretilir).
async function exportExcel() {
  exporting.value = true
  error.value = ''
  try {
    const query = regionFilter.value ? `?region=${regionFilter.value}` : ''
    await download(`/pilgrims/export${query}`, 'umreciler.xlsx')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Excel dosyası indirilemedi.'
  } finally {
    exporting.value = false
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined

function regionName(p: Pilgrim) {
  return p.region && typeof p.region === 'object' ? p.region.name : null
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('tr-TR') : '—'
}

function roomNumber(p: Pilgrim) {
  return p.room && typeof p.room === 'object' ? p.room.roomNumber : null
}

async function load() {
  loading.value = true
  error.value = ''
  const term = search.value.trim()
  const conditions: Where[] = [
    showArchived.value ? { archived: { equals: true } } : { archived: { not_equals: true } },
  ]
  if (term) {
    conditions.push({
      or: [
        { fullName: { like: term } },
        { tcNo: { like: term } },
        { passportNo: { like: term } },
        { phone: { like: term } },
      ],
    })
  }
  if (regionFilter.value) conditions.push({ region: { equals: regionFilter.value } })
  if (flightPointFilter.value === 'none') conditions.push({ flightPoint: { exists: false } })
  else if (flightPointFilter.value) {
    conditions.push({ flightPoint: { equals: flightPointFilter.value } })
  }
  const where: Where = { and: conditions }
  try {
    const res = await find<Pilgrim>('pilgrims', { limit: 0, depth: 1, sort: 'fullName', where })
    items.value = res.docs
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Umreciler yüklenemedi.'
  } finally {
    loading.value = false
  }
}

watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(load, 300)
})

watch([regionFilter, flightPointFilter, showArchived], load)

onMounted(async () => {
  find<Region>('regions', { limit: 0, sort: 'name' })
    .then((res) => (regions.value = res.docs))
    .catch(() => undefined)
  find<FlightPoint>('flight-points', { limit: 0, sort: 'name' })
    .then((res) => (flightPoints.value = res.docs))
    .catch(() => undefined)
  await load()
})
</script>

<template>
  <section>
    <div class="page-header">
      <h1>{{ showArchived ? 'Arşiv' : 'Umreciler' }}</h1>
      <div class="toolbar">
        <div class="segmented" role="group" aria-label="Liste">
          <button
            type="button"
            class="btn btn-sm"
            :class="showArchived ? 'btn-secondary' : 'btn-primary'"
            :aria-pressed="!showArchived"
            @click="showArchived = false"
          >
            Aktif
          </button>
          <button
            type="button"
            class="btn btn-sm"
            :class="showArchived ? 'btn-primary' : 'btn-secondary'"
            :aria-pressed="showArchived"
            @click="showArchived = true"
          >
            Arşiv
          </button>
        </div>
        <label class="field">
          <select v-model="regionFilter" aria-label="Bölgeye göre filtrele">
            <option value="">Tüm bölgeler</option>
            <option v-for="r in regions" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
        </label>
        <label v-if="flightPoints.length" class="field">
          <select v-model="flightPointFilter" aria-label="Uçuş noktasına göre filtrele">
            <option value="">Tüm uçuş noktaları</option>
            <option v-for="p in flightPoints" :key="p.id" :value="p.id">
              {{ flightPointLabel(p) }}
            </option>
            <option value="none">Uçuş noktası seçilmemiş</option>
          </select>
        </label>
        <label class="field">
          <input v-model="search" type="search" placeholder="Ad, TC, pasaport, telefon…" />
        </label>
        <button
          v-if="!showArchived"
          type="button"
          class="btn btn-secondary"
          :disabled="exporting"
          @click="exportExcel"
        >
          {{ exporting ? 'Hazırlanıyor…' : "Excel'e aktar" }}
        </button>
        <RouterLink :to="{ name: 'pilgrim-new' }" class="btn btn-primary">Yeni umreci</RouterLink>
      </div>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

    <p v-if="!loading && items.length" class="summary">
      <strong>{{ items.length }}</strong> {{ showArchived ? 'arşivde umreci' : 'umreci' }}
      <template v-if="childCount"> · {{ childCount }} çocuk</template>
      <template v-if="infantCount"> · {{ infantCount }} bebek</template>
    </p>

    <div class="card table-wrap">
      <p v-if="loading" class="empty-state">Yükleniyor…</p>
      <p v-else-if="!items.length" class="empty-state">
        {{ showArchived ? 'Arşivde umreci yok.' : 'Kayıtlı umreci bulunamadı.' }}
      </p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Ad Soyad</th>
            <th class="num">Yaş</th>
            <th>Bölge</th>
            <th>Uçuş</th>
            <th>TC Kimlik No</th>
            <th>Pasaport No</th>
            <th>Telefon</th>
            <template v-if="showArchived">
              <th>Arşiv tarihi</th>
              <th>İptal nedeni</th>
            </template>
            <template v-else>
              <th>Oda</th>
              <th class="num">Oda ücreti</th>
            </template>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in items"
            :key="p.id"
            :class="{ infant: isInfant(p.birthDate), child: isChild(p.birthDate) }"
          >
            <td>{{ p.firstName }} {{ p.lastName }}</td>
            <td class="num">
              <span v-if="isInfant(p.birthDate)" class="badge badge-infant">Bebek</span>
              <span v-else-if="isChild(p.birthDate)" class="badge badge-child">Çocuk</span>
              {{ ageOn(p.birthDate) ?? '—' }}
            </td>
            <td>{{ regionName(p) || '—' }}</td>
            <td>{{ flightPointLabel(p.flightPoint) || '—' }}</td>
            <td>{{ p.tcNo || '—' }}</td>
            <td>{{ p.passportNo || '—' }}</td>
            <td>{{ p.phone || '—' }}</td>
            <template v-if="showArchived">
              <td>{{ formatDate(p.archivedAt) }}</td>
              <td>{{ p.archiveReason || '—' }}</td>
            </template>
            <template v-else>
              <td>
                <span v-if="roomNumber(p)">Oda {{ roomNumber(p) }}</span>
                <span v-else class="badge badge-warning">Atanmadı</span>
              </td>
              <td class="num">{{ formatMoney(p.roomPrice, p.roomCurrency) }}</td>
            </template>
            <td class="actions">
              <RouterLink
                :to="{ name: 'pilgrim-edit', params: { id: p.id } }"
                class="btn btn-secondary btn-sm"
              >
                Düzenle
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.segmented {
  display: flex;
  gap: 0.25rem;
}

.alert {
  margin-bottom: 1rem;
}

.summary {
  margin: 0 0 0.5rem;
  color: var(--color-muted);
}

.summary strong {
  color: var(--color-heading);
}

/* Bebekler (0-1 yaş) yatak tutmaz; listede ayırt edilsin. */
tr.infant td {
  background: var(--color-primary-soft);
}

.badge-infant {
  margin-right: 0.375rem;
  background: var(--color-primary);
  color: var(--color-on-primary);
}

/* Çocuklar (2-11 yaş) bebeklerden farklı renkte. */
tr.child td {
  background: var(--color-warning-soft);
}

.badge-child {
  margin-right: 0.375rem;
  background: var(--color-warning);
  color: var(--color-on-primary);
}
</style>
