<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { find } from '@/api/collections'
import type { Pilgrim, Where } from '@/types/payload'
import { formatMoney } from '@/utils/accommodation'

const items = ref<Pilgrim[]>([])
const search = ref('')
const loading = ref(false)
const error = ref('')

let searchTimer: ReturnType<typeof setTimeout> | undefined

function roomNumber(p: Pilgrim) {
  return p.room && typeof p.room === 'object' ? p.room.roomNumber : null
}

async function load() {
  loading.value = true
  error.value = ''
  const term = search.value.trim()
  const where: Where | undefined = term
    ? {
        or: [
          { fullName: { like: term } },
          { tcNo: { like: term } },
          { passportNo: { like: term } },
          { phone: { like: term } },
        ],
      }
    : undefined
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

onMounted(load)
</script>

<template>
  <section>
    <div class="page-header">
      <h1>Umreciler</h1>
      <div class="toolbar">
        <label class="field">
          <input v-model="search" type="search" placeholder="Ad, TC, pasaport, telefon…" />
        </label>
        <RouterLink :to="{ name: 'pilgrim-new' }" class="btn btn-primary">Yeni umreci</RouterLink>
      </div>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

    <div class="card table-wrap">
      <p v-if="loading" class="empty-state">Yükleniyor…</p>
      <p v-else-if="!items.length" class="empty-state">Kayıtlı umreci bulunamadı.</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Ad Soyad</th>
            <th>TC Kimlik No</th>
            <th>Pasaport No</th>
            <th>Telefon</th>
            <th>Oda</th>
            <th class="num">Oda ücreti</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in items" :key="p.id">
            <td>{{ p.firstName }} {{ p.lastName }}</td>
            <td>{{ p.tcNo || '—' }}</td>
            <td>{{ p.passportNo || '—' }}</td>
            <td>{{ p.phone || '—' }}</td>
            <td>
              <span v-if="roomNumber(p)">Oda {{ roomNumber(p) }}</span>
              <span v-else class="badge badge-warning">Atanmadı</span>
            </td>
            <td class="num">{{ formatMoney(p.roomPrice, p.roomCurrency) }}</td>
            <td class="actions">
              <RouterLink
                :to="{ name: 'pilgrim-edit', params: { id: p.id } }"
                class="btn btn-secondary btn-sm"
              >
                {{ roomNumber(p) ? 'Düzenle' : 'Odaya ata' }}
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

.alert {
  margin-bottom: 1rem;
}
</style>
