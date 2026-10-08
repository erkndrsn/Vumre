<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { create, find, remove, update } from '@/api/collections'
import type { Currency, RoomType } from '@/types/payload'
import { CURRENCIES, formatMoney } from '@/utils/accommodation'

interface FormState {
  name: string
  capacity: number | null
  pricePerPerson: number | null
  currency: Currency
  description: string
  active: boolean
}

const items = ref<RoomType[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const editingId = ref<number | null>(null)
const showForm = ref(false)

const emptyForm = (): FormState => ({
  name: '',
  capacity: null,
  pricePerPerson: null,
  currency: 'USD',
  description: '',
  active: true,
})
const form = reactive<FormState>(emptyForm())

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await find<RoomType>('room-types', { limit: 0, sort: 'capacity' })
    items.value = res.docs
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Oda tipleri yüklenemedi.'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  Object.assign(form, emptyForm())
  editingId.value = null
  showForm.value = true
}

function openEdit(item: RoomType) {
  Object.assign(form, {
    name: item.name,
    capacity: item.capacity,
    pricePerPerson: item.pricePerPerson,
    currency: item.currency,
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
    const data = {
      ...form,
      capacity: form.capacity ?? undefined,
      pricePerPerson: form.pricePerPerson ?? undefined,
    }
    if (editingId.value) await update<RoomType>('room-types', editingId.value, data)
    else await create<RoomType>('room-types', data)
    showForm.value = false
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Kaydedilemedi.'
  } finally {
    saving.value = false
  }
}

async function destroy(item: RoomType) {
  if (!confirm(`"${item.name}" oda tipi silinsin mi?`)) return
  error.value = ''
  try {
    await remove('room-types', item.id)
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
      <h1>Oda Tipleri</h1>
      <button class="btn btn-primary" @click="openCreate">Yeni oda tipi</button>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

    <form v-if="showForm" class="card form editor" @submit.prevent="save">
      <h2>{{ editingId ? 'Oda tipini düzenle' : 'Yeni oda tipi' }}</h2>
      <div class="form-grid">
        <label class="field">
          <span>Oda tipi adı</span>
          <input v-model.trim="form.name" required placeholder="3 Kişilik Standart" />
        </label>
        <label class="field">
          <span>Kişi kapasitesi</span>
          <input v-model.number="form.capacity" type="number" min="1" required />
        </label>
        <label class="field">
          <span>Kişi başı ücret</span>
          <input v-model.number="form.pricePerPerson" type="number" min="0" step="0.01" required />
        </label>
        <label class="field">
          <span>Para birimi</span>
          <select v-model="form.currency">
            <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
          </select>
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
      <p v-else-if="!items.length" class="empty-state">Henüz oda tipi tanımlanmadı.</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Oda tipi</th>
            <th class="num">Kapasite</th>
            <th class="num">Kişi başı ücret</th>
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
            <td class="num">{{ item.capacity }} kişi</td>
            <td class="num">{{ formatMoney(item.pricePerPerson, item.currency) }}</td>
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
