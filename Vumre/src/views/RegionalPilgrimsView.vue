<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { find } from '@/api/collections'
import { useAuthStore } from '@/stores/auth'
import type { Pilgrim, Region, User, Where } from '@/types/payload'
import { GENDER_LABELS } from '@/utils/accommodation'
import { ageOn } from '@/utils/childPricing'

interface RegionGroup {
  key: string
  name: string
  pilgrims: Pilgrim[]
  male: number
  female: number
}

const auth = useAuthStore()
const items = ref<Pilgrim[]>([])
const regions = ref<Region[]>([])
const regionFilter = ref<number | ''>('')
const loading = ref(false)
const error = ref('')
// Admin her bölgenin yöneticilerini görür: bölge id → yönetici adları.
const managersByRegion = ref<Record<string, string[]>>({})

// Bölge adına göre sıralı; bölgesi olmayan eski kayıtlar en sonda.
const groups = computed<RegionGroup[]>(() => {
  const byRegion = new Map<string, RegionGroup>()
  for (const p of items.value) {
    const region = p.region && typeof p.region === 'object' ? p.region : null
    const key = region ? String(region.id) : 'none'
    let group = byRegion.get(key)
    if (!group) {
      group = { key, name: region?.name ?? 'Bölgesi yok', pilgrims: [], male: 0, female: 0 }
      byRegion.set(key, group)
    }
    group.pilgrims.push(p)
    group[p.gender]++
  }
  return [...byRegion.values()].sort((a, b) =>
    a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.name.localeCompare(b.name, 'tr'),
  )
})

async function load() {
  loading.value = true
  error.value = ''
  const conditions: Where[] = [{ archived: { not_equals: true } }]
  if (regionFilter.value) conditions.push({ region: { equals: regionFilter.value } })
  try {
    const res = await find<Pilgrim>('pilgrims', {
      limit: 0,
      depth: 1,
      sort: 'fullName',
      where: { and: conditions },
    })
    items.value = res.docs
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Umreciler yüklenemedi.'
  } finally {
    loading.value = false
  }
}

watch(regionFilter, load)

onMounted(async () => {
  find<Region>('regions', { limit: 0, sort: 'name' })
    .then((res) => (regions.value = res.docs))
    .catch(() => undefined)
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
      <div class="header-actions">
        <label class="field">
          <select v-model="regionFilter" aria-label="Bölgeye göre filtrele">
            <option value="">Tüm bölgeler</option>
            <option v-for="r in regions" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
        </label>
        <RouterLink
          :to="{
            name: 'pilgrim-new',
            query:
              regionFilter && auth.canEditRegion(regionFilter)
                ? { region: String(regionFilter) }
                : {},
          }"
          class="btn btn-primary"
          >Yeni umreci</RouterLink
        >
      </div>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

    <p v-if="loading" class="card empty-state">Yükleniyor…</p>
    <p v-else-if="!groups.length" class="card empty-state">Kayıtlı umreci bulunamadı.</p>
    <div v-else class="region-grid">
      <article v-for="g in groups" :key="g.key" class="card region">
        <header class="region-header">
          <h2>
            {{ g.name }}
            <span
              v-if="g.key !== 'none' && !auth.canEditRegion(Number(g.key))"
              class="badge"
              title="Sorumlu olduğunuz bölgelerden biri değil; kayıtlar yalnızca görüntülenebilir."
              >Yalnızca görüntüleme</span
            >
          </h2>
          <span class="muted">
            {{ g.pilgrims.length }} kişi · {{ g.male }} E · {{ g.female }} K
          </span>
        </header>
        <p v-if="managersByRegion[g.key]" class="muted managers">
          Yönetici: {{ managersByRegion[g.key]?.join(', ') }}
        </p>
        <div class="table-wrap">
          <table class="table compact">
            <thead>
              <tr>
                <th>Ad Soyad</th>
                <th>Telefon</th>
                <th>Cinsiyet</th>
                <th class="num">Yaş</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in g.pilgrims" :key="p.id">
                <td>
                  <RouterLink :to="{ name: 'pilgrim-edit', params: { id: p.id } }">
                    {{ p.firstName }} {{ p.lastName }}
                  </RouterLink>
                </td>
                <td>{{ p.phone || '—' }}</td>
                <td>{{ GENDER_LABELS[p.gender] }}</td>
                <td class="num">{{ ageOn(p.birthDate) ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.alert {
  margin-bottom: 1rem;
}

.region-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
  gap: 1rem;
  align-items: start;
}

.region {
  padding: 1rem;
}

.region-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.region-header h2 {
  font-size: 1rem;
}

.region-header .muted {
  font-size: 0.8125rem;
  white-space: nowrap;
}

.managers {
  font-size: 0.8125rem;
  margin: 0 0 0.5rem;
}

.table.compact {
  font-size: 0.875rem;
}

.table.compact th,
.table.compact td {
  padding: 0.3rem 0.5rem;
}
</style>
