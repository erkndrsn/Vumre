<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { create, find, findById, remove, update } from '@/api/collections'
import type { Gender, Pilgrim, Room, RoomType } from '@/types/payload'
import {
  GENDER_LABELS,
  ROOM_STATUS_BADGE,
  formatMoney,
  freeBeds,
  occupancyText,
  roomStatusText,
  roomTypeOf,
} from '@/utils/accommodation'

interface FormState {
  firstName: string
  lastName: string
  tcNo: string
  passportNo: string
  phone: string
  birthDate: string
  gender: Gender | ''
  address: string
  description: string
}

const route = useRoute()
const router = useRouter()

const pilgrimId = computed(() => (route.params.id ? Number(route.params.id) : null))
const isEdit = computed(() => pilgrimId.value !== null)

const form = reactive<FormState>({
  firstName: '',
  lastName: '',
  tcNo: '',
  passportNo: '',
  phone: '',
  birthDate: '',
  gender: '',
  address: '',
  description: '',
})
const pilgrim = ref<Pilgrim | null>(null)
const saving = ref(false)
const error = ref('')
const success = ref('')

// Oda ataması
const roomTypes = ref<RoomType[]>([])
const selectedTypeId = ref<number | ''>('')
const rooms = ref<Room[]>([])
const onlyAvailable = ref(true)
const roomsLoading = ref(false)
const assigning = ref(false)

const currentRoom = computed(() =>
  pilgrim.value?.room && typeof pilgrim.value.room === 'object' ? pilgrim.value.room : null,
)
const visibleRooms = computed(() =>
  onlyAvailable.value
    ? rooms.value.filter((r) => freeBeds(r) > 0 || isCurrentRoom(r))
    : rooms.value,
)

function isCurrentRoom(room: Room) {
  return currentRoom.value?.id === room.id
}

function fillForm(p: Pilgrim) {
  Object.assign(form, {
    firstName: p.firstName,
    lastName: p.lastName,
    tcNo: p.tcNo ?? '',
    passportNo: p.passportNo ?? '',
    phone: p.phone ?? '',
    birthDate: p.birthDate ? p.birthDate.slice(0, 10) : '',
    gender: p.gender,
    address: p.address ?? '',
    description: p.description ?? '',
  })
}

function payload() {
  // Boş metinleri null gönder: TC / pasaport alanları benzersiz olduğu için "" çakışır.
  const orNull = (v: string) => (v.trim() ? v.trim() : null)
  return {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    tcNo: orNull(form.tcNo),
    passportNo: orNull(form.passportNo),
    phone: orNull(form.phone),
    birthDate: form.birthDate || null,
    gender: form.gender as Gender,
    address: orNull(form.address),
    description: orNull(form.description),
  }
}

async function loadPilgrim() {
  if (!pilgrimId.value) return
  const p = await findById<Pilgrim>('pilgrims', pilgrimId.value, { depth: 2 })
  pilgrim.value = p
  fillForm(p)
  const type = currentRoom.value ? roomTypeOf(currentRoom.value) : null
  if (type && !selectedTypeId.value) selectedTypeId.value = type.id
}

async function loadRooms() {
  if (!selectedTypeId.value) {
    rooms.value = []
    return
  }
  roomsLoading.value = true
  try {
    const res = await find<Room>('rooms', {
      limit: 0,
      depth: 0,
      sort: 'roomNumber',
      where: { roomType: { equals: selectedTypeId.value }, active: { equals: true } },
    })
    rooms.value = res.docs
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Odalar yüklenemedi.'
  } finally {
    roomsLoading.value = false
  }
}

async function save() {
  saving.value = true
  error.value = ''
  success.value = ''
  try {
    if (pilgrimId.value) {
      await update<Pilgrim>('pilgrims', pilgrimId.value, payload())
      await loadPilgrim()
      success.value = 'Bilgiler kaydedildi.'
    } else {
      const doc = await create<Pilgrim>('pilgrims', payload())
      // Kayıttan sonra oda ataması aynı ekranda yapılabilsin.
      await router.replace({ name: 'pilgrim-edit', params: { id: doc.id } })
      success.value = 'Umreci kaydedildi. Şimdi bir odaya atayabilirsiniz.'
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Kaydedilemedi.'
  } finally {
    saving.value = false
  }
}

async function assignRoom(room: Room | null) {
  if (!pilgrimId.value) return
  assigning.value = true
  error.value = ''
  success.value = ''
  try {
    await update<Pilgrim>('pilgrims', pilgrimId.value, { room: room?.id ?? null })
    await loadPilgrim()
    success.value = room ? `Oda ${room.roomNumber}'e atandı.` : 'Oda ataması kaldırıldı.'
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Oda ataması yapılamadı.'
  } finally {
    // Doluluk her durumda tazelensin (başkası aynı anda odayı doldurmuş olabilir).
    await loadRooms()
    assigning.value = false
  }
}

async function destroy() {
  if (!pilgrimId.value || !confirm('Bu umreci kaydı silinsin mi?')) return
  try {
    await remove('pilgrims', pilgrimId.value)
    await router.replace({ name: 'pilgrims' })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Silinemedi.'
  }
}

watch(selectedTypeId, loadRooms)
watch(pilgrimId, async () => {
  try {
    await loadPilgrim()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Umreci yüklenemedi.'
  }
})

onMounted(async () => {
  try {
    const res = await find<RoomType>('room-types', {
      limit: 0,
      sort: 'capacity',
      where: { active: { equals: true } },
    })
    roomTypes.value = res.docs
    await loadPilgrim()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Veriler yüklenemedi.'
  }
})
</script>

<template>
  <section>
    <div class="page-header">
      <h1>{{ isEdit ? `${form.firstName} ${form.lastName}` : 'Yeni umreci' }}</h1>
      <RouterLink :to="{ name: 'pilgrims' }" class="btn btn-secondary">Listeye dön</RouterLink>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
    <div v-if="success" class="alert alert-success" role="status">{{ success }}</div>

    <form class="card form block" @submit.prevent="save">
      <h2>Kişi bilgileri</h2>
      <div class="form-grid">
        <label class="field">
          <span>Ad</span>
          <input v-model="form.firstName" required />
        </label>
        <label class="field">
          <span>Soyad</span>
          <input v-model="form.lastName" required />
        </label>
        <label class="field">
          <span>TC Kimlik No</span>
          <input v-model="form.tcNo" inputmode="numeric" maxlength="11" pattern="\d{11}" />
        </label>
        <label class="field">
          <span>Pasaport No</span>
          <input v-model="form.passportNo" />
        </label>
        <label class="field">
          <span>Telefon</span>
          <input v-model="form.phone" type="tel" />
        </label>
        <label class="field">
          <span>Doğum tarihi</span>
          <input v-model="form.birthDate" type="date" />
        </label>
        <label class="field">
          <span>Cinsiyet</span>
          <select v-model="form.gender" required>
            <option value="" disabled>Seçin</option>
            <option v-for="(label, value) in GENDER_LABELS" :key="value" :value="value">
              {{ label }}
            </option>
          </select>
        </label>
        <label class="field span-all">
          <span>Adres</span>
          <textarea v-model="form.address" rows="2" />
        </label>
        <label class="field span-all">
          <span>Açıklama</span>
          <textarea v-model="form.description" rows="2" />
        </label>
      </div>
      <div class="form-actions">
        <button v-if="isEdit" type="button" class="btn btn-danger" @click="destroy">Sil</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Kaydediliyor…' : 'Kaydet' }}
        </button>
      </div>
    </form>

    <div v-if="isEdit" class="card block">
      <h2>Oda ataması</h2>

      <div class="current">
        <template v-if="currentRoom">
          <div>
            <span class="muted">Mevcut oda</span>
            <strong>Oda {{ currentRoom.roomNumber }}</strong>
            <span class="muted">· {{ roomTypeOf(currentRoom)?.name }}</span>
          </div>
          <div>
            <span class="muted">Ödenecek ücret</span>
            <strong>{{ formatMoney(pilgrim?.roomPrice, pilgrim?.roomCurrency) }}</strong>
          </div>
          <button class="btn btn-secondary btn-sm" :disabled="assigning" @click="assignRoom(null)">
            Odadan çıkar
          </button>
        </template>
        <span v-else class="badge badge-warning">Henüz bir odaya atanmadı</span>
      </div>

      <div class="room-filters">
        <label class="field">
          <span>Oda tipi</span>
          <select v-model="selectedTypeId">
            <option value="">Seçin</option>
            <option v-for="t in roomTypes" :key="t.id" :value="t.id">
              {{ t.name }} — {{ t.capacity }} kişi,
              {{ formatMoney(t.pricePerPerson, t.currency) }} / kişi
            </option>
          </select>
        </label>
        <label class="field field-check">
          <input v-model="onlyAvailable" type="checkbox" />
          <span>Yalnızca boş yeri olan odalar</span>
        </label>
      </div>

      <div v-if="selectedTypeId" class="table-wrap">
        <p v-if="roomsLoading" class="empty-state">Odalar yükleniyor…</p>
        <p v-else-if="!visibleRooms.length" class="empty-state">
          Bu oda tipinde {{ onlyAvailable ? 'boş yeri olan ' : '' }}oda yok.
        </p>
        <table v-else class="table">
          <thead>
            <tr>
              <th>Oda</th>
              <th class="num">Kapasite</th>
              <th class="num">Doluluk</th>
              <th>Durum</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="room in visibleRooms" :key="room.id">
              <td>{{ room.roomNumber }}</td>
              <td class="num">{{ room.capacity }}</td>
              <td class="num">{{ occupancyText(room) }}</td>
              <td>
                <span class="badge" :class="ROOM_STATUS_BADGE[room.status ?? 'empty']">
                  {{ roomStatusText(room) }}
                </span>
              </td>
              <td class="actions">
                <span v-if="isCurrentRoom(room)" class="badge badge-success">Bu odada</span>
                <button
                  v-else
                  class="btn btn-primary btn-sm"
                  :disabled="assigning || freeBeds(room) === 0"
                  @click="assignRoom(room)"
                >
                  {{ currentRoom ? 'Bu odaya taşı' : 'Ata' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<style scoped>
.alert,
.block {
  margin-bottom: 1rem;
}

.block h2 {
  font-size: 1.125rem;
  margin-bottom: 1rem;
}

.form h2 {
  margin-bottom: 0;
}

.current {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1.5rem;
  margin-bottom: 1.25rem;
}

.current > div {
  display: flex;
  flex-direction: column;
}

.current .muted {
  font-size: 0.8125rem;
}

.room-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 1rem;
  margin-bottom: 1rem;
}

.room-filters .field:first-child {
  min-width: min(100%, 360px);
}
</style>
