<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { create, find, remove, update } from '@/api/collections'
import type { Room, RoomType } from '@/types/payload'
import { ROOM_STATUS_BADGE, occupancyText, roomStatusText, roomTypeOf } from '@/utils/accommodation'

interface FormState {
  roomNumber: string
  roomType: number | null
  description: string
  active: boolean
}

const roomTypes = ref<RoomType[]>([])
const rooms = ref<Room[]>([])
const filterType = ref<number | ''>('')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const editingId = ref<number | null>(null)
const showForm = ref(false)

const emptyForm = (): FormState => ({
  roomNumber: '',
  roomType: null,
  description: '',
  active: true,
})
const form = reactive<FormState>(emptyForm())

const activeRoomTypes = computed(() => roomTypes.value.filter((t) => t.active !== false))
const selectedType = computed(() => roomTypes.value.find((t) => t.id === form.roomType))

async function loadRoomTypes() {
  const res = await find<RoomType>('room-types', { limit: 0, sort: 'capacity' })
  roomTypes.value = res.docs
}

async function loadRooms() {
  loading.value = true
  error.value = ''
  try {
    const res = await find<Room>('rooms', {
      limit: 0,
      depth: 1,
      sort: 'roomNumber',
      where: filterType.value ? { roomType: { equals: filterType.value } } : undefined,
    })
    rooms.value = res.docs
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Odalar yüklenemedi.'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  Object.assign(form, emptyForm(), { roomType: filterType.value || null })
  editingId.value = null
  showForm.value = true
}

function openEdit(room: Room) {
  Object.assign(form, {
    roomNumber: room.roomNumber,
    roomType: roomTypeOf(room)?.id ?? room.roomType,
    description: room.description ?? '',
    active: room.active !== false,
  })
  editingId.value = room.id
  showForm.value = true
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    const data = { ...form, roomType: form.roomType ?? undefined }
    if (editingId.value) await update<Room>('rooms', editingId.value, data)
    else await create<Room>('rooms', data)
    showForm.value = false
    await loadRooms()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Kaydedilemedi.'
  } finally {
    saving.value = false
  }
}

async function destroy(room: Room) {
  if (!confirm(`Oda ${room.roomNumber} silinsin mi?`)) return
  error.value = ''
  try {
    await remove('rooms', room.id)
    await loadRooms()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Silinemedi.'
  }
}

watch(filterType, loadRooms)

onMounted(async () => {
  try {
    await loadRoomTypes()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Oda tipleri yüklenemedi.'
  }
  await loadRooms()
})
</script>

<template>
  <section>
    <div class="page-header">
      <h1>Odalar</h1>
      <div class="toolbar">
        <label class="field">
          <select v-model="filterType" aria-label="Oda tipine göre filtrele">
            <option value="">Tüm oda tipleri</option>
            <option v-for="t in roomTypes" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
        </label>
        <button class="btn btn-primary" :disabled="!activeRoomTypes.length" @click="openCreate">
          Yeni oda
        </button>
      </div>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
    <p v-if="!roomTypes.length && !loading" class="alert alert-error">
      Oda eklemek için önce bir oda tipi tanımlayın.
    </p>

    <form v-if="showForm" class="card form editor" @submit.prevent="save">
      <h2>{{ editingId ? 'Odayı düzenle' : 'Yeni oda' }}</h2>
      <div class="form-grid">
        <label class="field">
          <span>Oda numarası</span>
          <input v-model.trim="form.roomNumber" required placeholder="101" />
        </label>
        <label class="field">
          <span>Oda tipi</span>
          <select v-model="form.roomType" required>
            <option :value="null" disabled>Seçin</option>
            <option v-for="t in activeRoomTypes" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
        </label>
        <label class="field">
          <span>Kapasite</span>
          <input :value="selectedType ? `${selectedType.capacity} kişi` : ''" disabled />
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
      <p class="muted hint">Kapasite, seçilen oda tipinden otomatik alınır.</p>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" @click="showForm = false">Vazgeç</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Kaydediliyor…' : 'Kaydet' }}
        </button>
      </div>
    </form>

    <div class="card table-wrap">
      <p v-if="loading" class="empty-state">Yükleniyor…</p>
      <p v-else-if="!rooms.length" class="empty-state">Oda bulunamadı.</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Oda</th>
            <th>Oda tipi</th>
            <th class="num">Kapasite</th>
            <th class="num">Doluluk</th>
            <th>Durum</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="room in rooms"
            :key="room.id"
            :class="{ 'is-disabled': room.active === false }"
          >
            <td>
              {{ room.roomNumber }}
              <span v-if="room.active === false" class="badge">Pasif</span>
            </td>
            <td>{{ roomTypeOf(room)?.name ?? '—' }}</td>
            <td class="num">{{ room.capacity }}</td>
            <td class="num">{{ occupancyText(room) }}</td>
            <td>
              <span class="badge" :class="ROOM_STATUS_BADGE[room.status ?? 'empty']">
                {{ roomStatusText(room) }}
              </span>
            </td>
            <td class="actions">
              <button class="btn btn-secondary btn-sm" @click="openEdit(room)">Düzenle</button>
              <button class="btn btn-danger btn-sm" @click="destroy(room)">Sil</button>
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

.alert,
.editor {
  margin-bottom: 1rem;
}

.editor h2 {
  font-size: 1.125rem;
}

.hint {
  font-size: 0.875rem;
}
</style>
