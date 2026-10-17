<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { create, find, findById, remove, update } from '@/api/collections'
import { listGroups, updateGroup } from '@/api/paymentGroups'
import { useAuthStore } from '@/stores/auth'
import type {
  FlightPoint,
  Gender,
  PaymentGroup,
  Pilgrim,
  Region,
  Room,
  RoomType,
} from '@/types/payload'
import {
  GENDER_LABELS,
  ROOM_STATUS_BADGE,
  formatMoney,
  freeBeds,
  occupancyText,
  roomStatusText,
  roomTypeOf,
} from '@/utils/accommodation'
import { ageOn, isInfant, otherPricesForAge, priceForAge } from '@/utils/childPricing'
import PilgrimDocuments from './PilgrimDocuments.vue'

interface FormState {
  firstName: string
  lastName: string
  tcNo: string
  passportNo: string
  phone: string
  birthDate: string
  gender: Gender | ''
  region: number | null
  flightPoint: number | null
  paymentGroup: number | null
  address: string
  description: string
}

const route = useRoute()
const router = useRouter()
// Bölge yöneticisi yalnızca kişi bilgilerini düzenler; oda, ödeme grubu ve arşiv admine ait.
const auth = useAuthStore()
const isAdmin = computed(() => auth.isAdmin)
const listRoute = computed(() => ({ name: isAdmin.value ? 'pilgrims' : 'pilgrims-by-region' }))

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
  region: null,
  flightPoint: null,
  paymentGroup: null,
  address: '',
  description: '',
})
const pilgrim = ref<Pilgrim | null>(null)
const saving = ref(false)
const error = ref('')
const success = ref('')

// Oda ataması
const roomTypes = ref<RoomType[]>([])
const regions = ref<Region[]>([])
const flightPoints = ref<FlightPoint[]>([])
const paymentGroups = ref<PaymentGroup[]>([])
// Ödeme grubunu formdan çıkmadan oluşturma
const newGroupOpen = ref(false)
const newGroupName = ref('')
const creatingGroup = ref(false)
// Pasif bölgeler ve bölge yöneticisinin sorumlu olmadığı bölgeler seçime kapalı; kişinin mevcut
// bölgesi listede kalır.
const regionOptions = computed(() =>
  regions.value.filter(
    (r) => r.id === form.region || (r.active !== false && auth.canEditRegion(r.id)),
  ),
)
const flightPointOptions = computed(() =>
  flightPoints.value.filter((p) => p.active !== false || p.id === form.flightPoint),
)
const mainFlightPoint = computed(() => flightPoints.value.find((p) => p.isMain))
const selectedFlightPoint = computed(() =>
  flightPoints.value.find((p) => p.id === form.flightPoint),
)

const idOf = (value: number | { id: number } | null | undefined) =>
  value && typeof value === 'object' ? value.id : (value ?? null)

function regionFlightPoint(regionId: number | null) {
  return idOf(regions.value.find((r) => r.id === regionId)?.defaultFlightPoint)
}

// Bölge değişince uçuş noktası boşsa ya da önceki bölgenin noktasıysa yeni bölgenin noktası
// gelir; elle seçilmiş farklı bir nokta korunur.
watch(
  () => form.region,
  (region, previous) => {
    const previousDefault = regionFlightPoint(previous)
    const nextDefault = regionFlightPoint(region)
    if (nextDefault && (form.flightPoint === null || form.flightPoint === previousDefault)) {
      form.flightPoint = nextDefault
    }
  },
)

const selectedTypeId = ref<number | ''>('')
const rooms = ref<Room[]>([])
const onlyAvailable = ref(true)
const roomsLoading = ref(false)
const occupantsByRoom = ref<Record<number, Pilgrim[]>>({})
const assigning = ref(false)
const archiving = ref(false)

// Bölge yöneticisi başka bölgelerdeki umrecileri yalnızca görüntüler; yetki kayıtlı bölgeye göre.
const canEdit = computed(
  () =>
    !isEdit.value || (pilgrim.value !== null && auth.canEditRegion(idOf(pilgrim.value.region))),
)

// Programı iptal eden kişi arşivdedir: odası yoktur ve odaya atanamaz.
const isArchived = computed(() => pilgrim.value?.archived === true)

const currentRoom = computed(() =>
  pilgrim.value?.room && typeof pilgrim.value.room === 'object' ? pilgrim.value.room : null,
)
// Bebekler (0-1 yaş) yatak tutmaz; dolu odalara da atanabilir. Atama kayıtlı doğum
// tarihiyle yapıldığı için formdaki kaydedilmemiş değer değil, kayıtlı değer esas alınır.
const infant = computed(() => isInfant(pilgrim.value?.birthDate))
const canJoin = (room: Room) => infant.value || freeBeds(room) > 0
const visibleRooms = computed(() =>
  onlyAvailable.value ? rooms.value.filter((r) => canJoin(r) || isCurrentRoom(r)) : rooms.value,
)

// Seçili oda tipinde bu kişiye uygulanacak ücret (kayıtlı doğum tarihine göre).
const age = computed(() => ageOn(pilgrim.value?.birthDate))
const selectedType = computed(() => roomTypes.value.find((t) => t.id === selectedTypeId.value))
const expectedPrice = computed(() =>
  selectedType.value ? priceForAge(selectedType.value, age.value) : null,
)
const expectedOtherPrices = computed(() =>
  selectedType.value ? otherPricesForAge(selectedType.value, age.value) : [],
)
const isChildPrice = computed(
  () => !!selectedType.value && expectedPrice.value !== selectedType.value.pricePerPerson,
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
    region: p.region && typeof p.region === 'object' ? p.region.id : (p.region ?? null),
    flightPoint: idOf(p.flightPoint),
    paymentGroup:
      p.paymentGroup && typeof p.paymentGroup === 'object'
        ? p.paymentGroup.id
        : (p.paymentGroup ?? null),
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
    region: form.region,
    flightPoint: form.flightPoint,
    ...(isAdmin.value ? { paymentGroup: form.paymentGroup } : {}),
    address: orNull(form.address),
    description: orNull(form.description),
  }
}

// Yeni kayıtta bölge listeden gelen filtreyle ya da yöneticinin tek bölgesiyle önceden seçilir.
function preselectRegion() {
  const active = regions.value.filter((r) => r.active !== false && auth.canEditRegion(r.id))
  const fromQuery = Number(route.query.region)
  if (active.some((r) => r.id === fromQuery)) form.region = fromQuery
  else if (active.length === 1) form.region = active[0]!.id
}

async function loadPilgrim() {
  if (!pilgrimId.value) return
  const p = await findById<Pilgrim>('pilgrims', pilgrimId.value, { depth: 2 })
  pilgrim.value = p
  fillForm(p)
  const type = currentRoom.value ? roomTypeOf(currentRoom.value) : null
  if (type && !selectedTypeId.value) selectedTypeId.value = type.id
}

/** Listelenen odalarda kalan kişileri tek sorguda getirip odaya göre gruplar. */
async function loadOccupants(roomIds: number[]) {
  occupantsByRoom.value = {}
  if (!roomIds.length) return
  const res = await find<Pilgrim>('pilgrims', {
    limit: 0,
    depth: 0,
    sort: 'fullName',
    where: { room: { in: roomIds.join(',') } },
  })
  const grouped: Record<number, Pilgrim[]> = {}
  for (const p of res.docs) {
    if (typeof p.room === 'number') (grouped[p.room] ??= []).push(p)
  }
  occupantsByRoom.value = grouped
}

function occupantsOf(room: Room) {
  return (occupantsByRoom.value[room.id] ?? []).filter((p) => p.id !== pilgrimId.value)
}

/** Odada bu kişiden farklı cinsiyette biri var mı? */
function hasOtherGender(room: Room) {
  return !!form.gender && occupantsOf(room).some((p) => p.gender !== form.gender)
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
    await loadOccupants(res.docs.map((r) => r.id))
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Odalar yüklenemedi.'
  } finally {
    roomsLoading.value = false
  }
}

function openNewGroup() {
  // Aile grupları çoğunlukla soyadla anılır; ad öneri olarak gelir.
  newGroupName.value = form.lastName.trim() ? `${form.lastName.trim()} Ailesi` : ''
  newGroupOpen.value = true
}

async function createPaymentGroup() {
  const name = newGroupName.value.trim()
  if (!name) return
  creatingGroup.value = true
  error.value = ''
  try {
    // Üyesiz oluşturulur; kişi formu kaydedince gruba girer.
    const group = await create<PaymentGroup>('payment-groups', { name })
    paymentGroups.value = [...paymentGroups.value, group].sort((a, b) =>
      a.name.localeCompare(b.name, 'tr'),
    )
    form.paymentGroup = group.id
    newGroupOpen.value = false
    newGroupName.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ödeme grubu oluşturulamadı.'
  } finally {
    creatingGroup.value = false
  }
}

/** Sorumlusu olmayan gruba katılan ilk kişi sorumlu olur (hatırlatmalar ona gider). */
async function claimGroupResponsibility(pilgrimDocId: number) {
  if (!isAdmin.value) return
  const group = paymentGroups.value.find((g) => g.id === form.paymentGroup)
  if (!group || group.responsible) return
  // Kişi kaydedildi; sorumlu ataması başarısız olsa da kaydı bozmasın (grup ekranından seçilebilir).
  try {
    const updated = await updateGroup(group.id, { responsible: pilgrimDocId })
    group.responsible = updated.responsible
  } catch {
    /* yoksay */
  }
}

async function save() {
  saving.value = true
  error.value = ''
  success.value = ''
  try {
    if (pilgrimId.value) {
      await update<Pilgrim>('pilgrims', pilgrimId.value, payload())
      await claimGroupResponsibility(pilgrimId.value)
      await loadPilgrim()
      success.value = 'Bilgiler kaydedildi.'
    } else {
      const doc = await create<Pilgrim>('pilgrims', payload())
      await claimGroupResponsibility(doc.id)
      // Kayıttan sonra oda ataması aynı ekranda yapılabilsin.
      await router.replace({ name: 'pilgrim-edit', params: { id: doc.id } })
      success.value = isAdmin.value
        ? 'Umreci kaydedildi. Şimdi bir odaya atayabilirsiniz.'
        : 'Umreci kaydedildi.'
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Kaydedilemedi.'
  } finally {
    saving.value = false
  }
}

async function assignRoom(room: Room | null) {
  if (!pilgrimId.value) return
  if (room) {
    // Yanlış odaya eklemeyi önlemek için kimlerle kalacağını göstererek onay al.
    const names = occupantsOf(room).map((p) => `• ${p.firstName} ${p.lastName}`)
    const lines = [
      `${form.firstName} ${form.lastName} → Oda ${room.roomNumber}`,
      names.length ? `\nOdada kalanlar:\n${names.join('\n')}` : '\nOda şu an boş.',
      hasOtherGender(room) ? '\nDİKKAT: Odada farklı cinsiyetten kişiler var.' : '',
      '\nAtama yapılsın mı?',
    ]
    if (!confirm(lines.join('\n'))) return
  }
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

async function archive() {
  if (!pilgrimId.value) return
  const reason = prompt(
    `${form.firstName} ${form.lastName} programı iptal etti ve arşive taşınacak.` +
      (currentRoom.value ? ` Oda ${currentRoom.value.roomNumber} boşaltılacak.` : '') +
      '\n\nİptal nedeni (isteğe bağlı):',
  )
  if (reason === null) return
  archiving.value = true
  error.value = ''
  success.value = ''
  try {
    await update<Pilgrim>('pilgrims', pilgrimId.value, {
      archived: true,
      archiveReason: reason.trim() || null,
    })
    await loadPilgrim()
    success.value = 'Umreci arşive taşındı; oda yerleşiminde artık görünmez.'
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Arşive taşınamadı.'
  } finally {
    archiving.value = false
  }
}

async function restore() {
  if (!pilgrimId.value || !confirm('Umreci arşivden çıkarılıp aktif listeye alınsın mı?')) return
  archiving.value = true
  error.value = ''
  success.value = ''
  try {
    await update<Pilgrim>('pilgrims', pilgrimId.value, { archived: false })
    await loadPilgrim()
    success.value = 'Umreci arşivden çıkarıldı. Yeniden bir odaya atayabilirsiniz.'
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Arşivden çıkarılamadı.'
  } finally {
    archiving.value = false
  }
}

async function destroy() {
  if (!pilgrimId.value || !confirm('Bu umreci kaydı silinsin mi?')) return
  try {
    await remove('pilgrims', pilgrimId.value)
    await router.replace(listRoute.value)
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
    // Bölge yöneticisinin oda tiplerine ve ödeme gruplarına erişimi yok.
    const [types, regionRes, groups, pointRes] = await Promise.all([
      isAdmin.value
        ? find<RoomType>('room-types', {
            limit: 0,
            sort: 'capacity',
            where: { active: { equals: true } },
          })
        : null,
      find<Region>('regions', { limit: 0, sort: 'name' }),
      isAdmin.value ? listGroups() : [],
      find<FlightPoint>('flight-points', { limit: 0, sort: 'name' }),
    ])
    flightPoints.value = pointRes.docs
    roomTypes.value = types?.docs ?? []
    regions.value = regionRes.docs
    paymentGroups.value = groups
    await loadPilgrim()
    if (!isEdit.value) preselectRegion()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Veriler yüklenemedi.'
  }
})
</script>

<template>
  <section>
    <div class="page-header">
      <h1>
        {{ isEdit ? `${form.firstName} ${form.lastName}` : 'Yeni umreci' }}
        <span v-if="isArchived" class="badge badge-warning">Arşivde</span>
      </h1>
      <RouterLink :to="listRoute" class="btn btn-secondary">Listeye dön</RouterLink>
    </div>

    <div v-if="isArchived" class="card block archived">
      <div>
        <strong>Bu umreci programı iptal etti ve arşivde.</strong>
        <p class="muted">
          Arşive taşınma:
          {{ pilgrim?.archivedAt ? new Date(pilgrim.archivedAt).toLocaleString('tr-TR') : '—' }}
          <template v-if="pilgrim?.archiveReason"> · Neden: {{ pilgrim.archiveReason }}</template>
        </p>
        <p class="muted">
          Oda yerleşiminde ve listelerde görünmez. Tahsilatı varsa borçlar ekranında iade edilecek
          tutar olarak kalır.
        </p>
      </div>
      <button
        v-if="isAdmin"
        type="button"
        class="btn btn-secondary"
        :disabled="archiving"
        @click="restore"
      >
        Arşivden çıkar
      </button>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
    <div v-if="success" class="alert alert-success" role="status">{{ success }}</div>

    <div v-if="isEdit && pilgrim && !canEdit" class="alert alert-info" role="status">
      Bu umreci sorumlu olduğunuz bölgelerden birinde değil; bilgilerini yalnızca
      görüntüleyebilirsiniz.
    </div>

    <form class="card form block" @submit.prevent="save">
      <h2>Kişi bilgileri</h2>
      <fieldset class="form-grid" :disabled="!canEdit">
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
        <label class="field">
          <span>Bölge</span>
          <select v-model="form.region" required>
            <option :value="null" disabled>Seçin</option>
            <option v-for="r in regionOptions" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
        </label>
        <div class="field">
          <span>Uçuş başlangıç noktası</span>
          <select v-model="form.flightPoint" aria-label="Uçuş başlangıç noktası">
            <option :value="null">Seçilmedi</option>
            <option v-for="p in flightPointOptions" :key="p.id" :value="p.id">
              {{ p.name }}{{ p.airportCode ? ` (${p.airportCode})` : '' }}
            </option>
          </select>
          <small class="muted hint">
            <template v-if="!flightPoints.length">
              Henüz uçuş noktası yok.
              <RouterLink v-if="isAdmin" :to="{ name: 'flight-points' }"
                >Uçuş noktası ekle</RouterLink
              >
            </template>
            <template v-else-if="selectedFlightPoint?.isMain">Ana uçuş, aktarmasız.</template>
            <template v-else-if="selectedFlightPoint && mainFlightPoint">
              {{ mainFlightPoint.city }} uçuşuna aktarmalı gelir.
            </template>
            <template v-else>Bölgenin uçuş noktası varsayılan olarak gelir.</template>
          </small>
        </div>
        <div v-if="isAdmin" class="field">
          <span>Ödeme grubu</span>
          <div v-if="newGroupOpen" class="inline-row">
            <input
              v-model="newGroupName"
              placeholder="Grup adı (ör. Yılmaz Ailesi)"
              aria-label="Yeni ödeme grubu adı"
              autofocus
              @keydown.enter.prevent="createPaymentGroup"
              @keydown.esc.prevent="newGroupOpen = false"
            />
            <button
              type="button"
              class="btn btn-primary btn-sm"
              :disabled="creatingGroup || !newGroupName.trim()"
              @click="createPaymentGroup"
            >
              {{ creatingGroup ? 'Oluşturuluyor…' : 'Oluştur' }}
            </button>
            <button type="button" class="btn btn-secondary btn-sm" @click="newGroupOpen = false">
              Vazgeç
            </button>
          </div>
          <div v-else class="inline-row">
            <select v-model="form.paymentGroup" aria-label="Ödeme grubu">
              <option :value="null">Yok (tek başına öder)</option>
              <option v-for="g in paymentGroups" :key="g.id" :value="g.id">{{ g.name }}</option>
            </select>
            <button type="button" class="btn btn-secondary btn-sm" @click="openNewGroup">
              + Yeni grup
            </button>
          </div>
          <small class="muted hint">
            Aile gibi birlikte ödeyenler; borç grubun toplamından takip edilir.
            <RouterLink
              v-if="isEdit && pilgrim?.paymentGroup"
              :to="{ name: 'payments', query: { pilgrim: String(pilgrimId) } }"
              >Grubun hesabı</RouterLink
            >
          </small>
        </div>
        <label class="field span-all">
          <span>Adres</span>
          <textarea v-model="form.address" rows="2" />
        </label>
        <label class="field span-all">
          <span>Açıklama</span>
          <textarea v-model="form.description" rows="2" />
        </label>
      </fieldset>
      <div v-if="canEdit" class="form-actions">
        <button v-if="isEdit && isAdmin" type="button" class="btn btn-danger" @click="destroy">
          Sil
        </button>
        <button
          v-if="isEdit && !isArchived && isAdmin"
          type="button"
          class="btn btn-secondary"
          :disabled="archiving"
          @click="archive"
        >
          {{ archiving ? 'Taşınıyor…' : 'İptal etti, arşive taşı' }}
        </button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Kaydediliyor…' : 'Kaydet' }}
        </button>
      </div>
    </form>

    <PilgrimDocuments v-if="pilgrimId && canEdit" :pilgrim-id="pilgrimId" />

    <div v-if="isEdit && !isArchived && isAdmin" class="card block">
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
            <span v-for="o in pilgrim?.roomOtherPrices ?? []" :key="o.currency" class="muted">
              · {{ formatMoney(o.price, o.currency) }}
            </span>
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
              {{ formatMoney(t.pricePerPerson, t.currency) }} / kişi{{
                t.childPrices?.length ? ' (çocuk ücretli)' : ''
              }}
            </option>
          </select>
        </label>
        <p v-if="selectedType" class="expected-price">
          <span class="muted">Bu kişi için ücret</span>
          <strong>{{ formatMoney(expectedPrice, selectedType.currency) }}</strong>
          <span v-for="o in expectedOtherPrices" :key="o.currency" class="muted">
            / {{ formatMoney(o.price, o.currency) }}
          </span>
          <span class="muted">
            <template v-if="age === null">· doğum tarihi yok, normal ücret</template>
            <template v-else>
              · {{ age }} yaş{{ isChildPrice ? ', çocuk ücreti' : ''
              }}{{ infant ? ', bebek: yatak tutmaz, dolu odaya da eklenebilir' : '' }}
            </template>
          </span>
        </p>
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
              <th>Odada kalanlar</th>
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
              <td>
                <ul v-if="occupantsOf(room).length" class="occupants">
                  <li v-for="p in occupantsOf(room)" :key="p.id">
                    <RouterLink :to="{ name: 'pilgrim-edit', params: { id: p.id } }">
                      {{ p.firstName }} {{ p.lastName }}
                    </RouterLink>
                    <span class="muted">
                      · {{ GENDER_LABELS[p.gender] }}{{ isInfant(p.birthDate) ? ' · bebek' : '' }}
                    </span>
                  </li>
                </ul>
                <span v-else class="muted">—</span>
                <span v-if="hasOtherGender(room)" class="badge badge-warning">
                  Farklı cinsiyet
                </span>
              </td>
              <td class="actions">
                <span v-if="isCurrentRoom(room)" class="badge badge-success">Bu odada</span>
                <button
                  v-else
                  class="btn btn-primary btn-sm"
                  :disabled="assigning || !canJoin(room)"
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

fieldset.form-grid {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.archived {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-left: 4px solid var(--color-warning);
}

.archived p {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
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

.expected-price {
  display: flex;
  flex-direction: column;
  margin: 0;
}

.expected-price .muted {
  font-size: 0.8125rem;
}

.occupants {
  margin: 0;
  padding-left: 1rem;
  font-size: 0.875rem;
}

.inline-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.inline-row > input,
.inline-row > select {
  flex: 1;
  min-width: 0;
}

.hint {
  font-size: 0.8125rem;
  font-weight: 400;
}
</style>
