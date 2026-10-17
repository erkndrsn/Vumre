<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { assignPilgrims, bulkCreateRooms, getRoomBoard } from '@/api/accommodation'
import { find } from '@/api/collections'
import { createGroup } from '@/api/paymentGroups'
import type { BoardPilgrim, BoardRoom, Gender, RoomType } from '@/types/payload'
import { GENDER_LABELS, expandRoomRange } from '@/utils/accommodation'

type Density = 'compact' | 'comfortable'
type PoolMode = 'all' | 'unassigned'

const DENSITY_KEY = 'vumre.roomBoard.density'

const rooms = ref<BoardRoom[]>([])
const pilgrims = ref<BoardPilgrim[]>([])
const roomTypes = ref<RoomType[]>([])
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')

function readDensity(): Density {
  try {
    return localStorage.getItem(DENSITY_KEY) === 'comfortable' ? 'comfortable' : 'compact'
  } catch {
    return 'compact'
  }
}
const density = ref<Density>(readDensity())
watch(density, (value) => {
  try {
    localStorage.setItem(DENSITY_KEY, value)
  } catch {
    // Tarayıcı depolaması kapalıysa tercih yalnızca bu oturumda kalır.
  }
})

// Sol panel: liste modu, filtreler ve seçim
const poolMode = ref<PoolMode>('all')
const search = ref('')
const regionFilter = ref<number | ''>('')
const genderFilter = ref<Gender | ''>('')
const selected = ref<Set<number>>(new Set())
// Seçilenlerden ödeme grubu oluşturma
const groupFormOpen = ref(false)
const groupName = ref('')

// Oda filtreleri
const roomSearch = ref('')
const roomTypeFilter = ref<number | ''>('')
const onlyFree = ref(false)

// Listede üzerine gelinen kişinin odası ve "odayı bul" vurgusu
const hoverRoom = ref<number | null>(null)
const locatedRoom = ref<number | null>(null)

const activeRoomTypes = computed(() => roomTypes.value.filter((t) => t.active !== false))

const roomById = computed(() => new Map(rooms.value.map((r) => [r.id, r])))
const pilgrimById = computed(() => new Map(pilgrims.value.map((p) => [p.id, p])))

const occupantsByRoom = computed(() => {
  const map = new Map<number, BoardPilgrim[]>()
  for (const p of pilgrims.value) {
    if (p.room === null) continue
    const list = map.get(p.room) ?? []
    list.push(p)
    map.set(p.room, list)
  }
  return map
})

const occupantsOf = (room: BoardRoom) => occupantsByRoom.value.get(room.id) ?? []
// Bebekler (0-1 yaş) odada listelenir ama yatak tutmaz.
const bedsTaken = (list: BoardPilgrim[]) => list.filter((p) => !p.infant).length
const infantsOf = (room: BoardRoom) => occupantsOf(room).filter((p) => p.infant).length
const freeOf = (room: BoardRoom) => Math.max(0, room.capacity - bedsTaken(occupantsOf(room)))
const isAssignable = (room: BoardRoom) => room.active && room.roomType?.active !== false
const isMixed = (room: BoardRoom) => new Set(occupantsOf(room).map((p) => p.gender)).size > 1
const roomNumberOf = (p: BoardPilgrim) =>
  p.room !== null ? (roomById.value.get(p.room)?.roomNumber ?? '?') : null

const unassignedCount = computed(() => pilgrims.value.filter((p) => p.room === null).length)

const regions = computed(() => {
  const map = new Map<number, string>()
  for (const p of pilgrims.value) if (p.region) map.set(p.region.id, p.region.name)
  return [...map]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
})

const filteredPilgrims = computed(() => {
  const term = search.value.trim().toLocaleLowerCase('tr')
  return pilgrims.value.filter(
    (p) =>
      (poolMode.value === 'all' || p.room === null) &&
      (!term ||
        p.fullName.toLocaleLowerCase('tr').includes(term) ||
        (roomNumberOf(p) ?? '').toLocaleLowerCase('tr').includes(term)) &&
      (!regionFilter.value || p.region?.id === regionFilter.value) &&
      (!genderFilter.value || p.gender === genderFilter.value),
  )
})

const visibleRooms = computed(() => {
  const term = roomSearch.value.trim().toLocaleLowerCase('tr')
  return rooms.value.filter(
    (r) =>
      (!term || r.roomNumber.toLocaleLowerCase('tr').includes(term)) &&
      (!roomTypeFilter.value || r.roomType?.id === roomTypeFilter.value) &&
      (!onlyFree.value || (isAssignable(r) && freeOf(r) > 0)),
  )
})

const stats = computed(() => {
  const usable = rooms.value.filter(isAssignable)
  const beds = usable.reduce((sum, r) => sum + r.capacity, 0)
  const free = usable.reduce((sum, r) => sum + freeOf(r), 0)
  return { rooms: rooms.value.length, beds, occupied: beds - free, free }
})

const allFilteredSelected = computed(
  () =>
    filteredPilgrims.value.length > 0 &&
    filteredPilgrims.value.every((p) => selected.value.has(p.id)),
)

const selectedAssignedCount = computed(
  () => [...selected.value].filter((id) => pilgrimById.value.get(id)?.room != null).length,
)

function toggle(id: number) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function toggleAll() {
  const next = new Set(selected.value)
  const select = !allFilteredSelected.value
  for (const p of filteredPilgrims.value) {
    if (select) next.add(p.id)
    else next.delete(p.id)
  }
  selected.value = next
}

function clearSelection() {
  selected.value = new Set()
}

/** Seçimden bu odaya gerçekten taşınacak kişiler (zaten odada olanlar sayılmaz). */
function incomingFor(room: BoardRoom, ids: Iterable<number>) {
  return [...ids].filter((id) => pilgrimById.value.get(id)?.room !== room.id)
}

function canTakeSelection(room: BoardRoom) {
  const incoming = incomingFor(room, selected.value)
  const needBeds = bedsTaken(
    incoming.map((id) => pilgrimById.value.get(id)).filter((p): p is BoardPilgrim => !!p),
  )
  return isAssignable(room) && incoming.length > 0 && needBeds <= freeOf(room)
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const board = await getRoomBoard()
    rooms.value = board.rooms
    pilgrims.value = board.pilgrims
    const ids = new Set(board.pilgrims.map((p) => p.id))
    selected.value = new Set([...selected.value].filter((id) => ids.has(id)))
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Yerleşim bilgisi yüklenemedi.'
  } finally {
    loading.value = false
  }
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined
function flash(message: string) {
  notice.value = message
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = ''), 4000)
}

/** Seçili kişileri yeni bir ödeme grubunda toplar (aile gibi birlikte ödeyenler). */
async function createGroupFromSelection() {
  const name = groupName.value.trim()
  if (!name || busy.value) return
  const members = [...selected.value]
    .map((id) => pilgrimById.value.get(id))
    .filter((p): p is BoardPilgrim => !!p)
  const grouped = members.filter((p) => p.paymentGroup)
  if (grouped.length) {
    error.value = `Şu kişiler zaten bir ödeme grubunda: ${grouped
      .map((p) => `${p.fullName} (${p.paymentGroup!.name})`)
      .join(', ')}.`
    return
  }
  busy.value = true
  error.value = ''
  try {
    await createGroup({ name, pilgrims: members.map((p) => p.id) })
    flash(`${name} ödeme grubu ${members.length} kişiyle oluşturuldu.`)
    groupFormOpen.value = false
    groupName.value = ''
    clearSelection()
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ödeme grubu oluşturulamadı.'
  } finally {
    busy.value = false
  }
}

/** Odaya atar; `room` null ise odadan çıkarır. Kapasite ve cinsiyet karışımı önce burada sorulur. */
async function move(room: BoardRoom | null, ids: number[]) {
  if (busy.value) return
  const movers = ids
    .map((id) => pilgrimById.value.get(id))
    .filter((p): p is BoardPilgrim => !!p)
    .filter((p) => (room ? p.room !== room.id : p.room !== null))
  if (!movers.length) return
  error.value = ''

  if (room) {
    const free = freeOf(room)
    const needBeds = bedsTaken(movers)
    if (needBeds > free) {
      error.value = `Oda ${room.roomNumber} için yatak gereken ${needBeds} kişi seçildi ama ${free} boş yer var.`
      return
    }
    const genders = new Set([...occupantsOf(room), ...movers].map((p) => p.gender))
    if (
      genders.size > 1 &&
      !confirm(`Oda ${room.roomNumber}'de kadın ve erkek birlikte kalacak. Devam edilsin mi?`)
    ) {
      return
    }
  }

  busy.value = true
  try {
    await assignPilgrims(
      room?.id ?? null,
      movers.map((p) => p.id),
    )
    const who = movers.length === 1 ? movers[0]!.fullName : `${movers.length} kişi`
    flash(room ? `${who} → Oda ${room.roomNumber}` : `${who} odadan çıkarıldı.`)
    const movedIds = new Set(movers.map((p) => p.id))
    selected.value = new Set([...selected.value].filter((id) => !movedIds.has(id)))
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Atama yapılamadı.'
    await load()
  } finally {
    busy.value = false
  }
}

function assignSelected(room: BoardRoom) {
  move(room, [...selected.value])
}

function unassignSelected() {
  move(null, [...selected.value])
}

/** Listede oda etiketine tıklanınca odayı görünür yapıp kısa süre vurgular. */
async function locateRoom(roomId: number) {
  const room = roomById.value.get(roomId)
  if (!room) return
  if (!visibleRooms.value.includes(room)) {
    roomSearch.value = ''
    roomTypeFilter.value = ''
    onlyFree.value = false
  }
  locatedRoom.value = roomId
  await nextTick()
  document
    .querySelector(`[data-room-id="${roomId}"]`)
    ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  setTimeout(() => {
    if (locatedRoom.value === roomId) locatedRoom.value = null
  }, 1600)
}

// Sürükle-bırak: listeden veya bir odadan kişi(ler) başka odaya ya da listeye (odadan çıkar) taşınır.
const drag = reactive<{ ids: number[]; over: number | 'pool' | null }>({ ids: [], over: null })

function onDragStart(event: DragEvent, p: BoardPilgrim) {
  // Seçili birini sürüklemek tüm seçimi taşır.
  drag.ids = selected.value.has(p.id) ? [...selected.value] : [p.id]
  event.dataTransfer?.setData('text/plain', drag.ids.join(','))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDragEnd() {
  drag.ids = []
  drag.over = null
}

const draggingAssigned = computed(() =>
  drag.ids.some((id) => pilgrimById.value.get(id)?.room != null),
)

function onRoomDragOver(event: DragEvent, room: BoardRoom) {
  if (!drag.ids.length || !isAssignable(room) || !incomingFor(room, drag.ids).length) return
  event.preventDefault()
  drag.over = room.id
}

function onRoomDrop(room: BoardRoom) {
  const ids = drag.ids
  onDragEnd()
  move(room, ids)
}

function onPoolDragOver(event: DragEvent) {
  if (!draggingAssigned.value) return
  event.preventDefault()
  drag.over = 'pool'
}

function onPoolDrop() {
  const ids = drag.ids
  onDragEnd()
  move(null, ids)
}

function onDragLeave(event: DragEvent, target: number | 'pool') {
  // Kart içindeki elemanlara geçerken vurgu sönmesin.
  const related = event.relatedTarget as Node | null
  if (related && (event.currentTarget as Node).contains(related)) return
  if (drag.over === target) drag.over = null
}

// Toplu oda oluşturma
const showBulk = ref(false)
const bulk = reactive({ roomType: null as number | null, prefix: '', from: '', to: '' })
const bulkPreview = computed(() =>
  bulk.from && bulk.to ? expandRoomRange(bulk.from, bulk.to, bulk.prefix) : null,
)
const bulkPreviewText = computed(() => {
  const numbers = bulkPreview.value?.numbers ?? []
  if (!numbers.length) return ''
  const shown = numbers.length > 6 ? [...numbers.slice(0, 3), '…', ...numbers.slice(-2)] : numbers
  return `${shown.join(', ')} (${numbers.length} oda)`
})

// Tek oda hızlı ekleme
const quick = reactive({ roomNumber: '', roomType: null as number | null })

async function createRooms(roomType: number | null, numbers: string[]) {
  if (!roomType || !numbers.length || busy.value) return false
  busy.value = true
  error.value = ''
  try {
    const res = await bulkCreateRooms(roomType, numbers)
    const parts = []
    if (res.created.length) parts.push(`${res.created.length} oda oluşturuldu`)
    if (res.skipped.length) parts.push(`zaten var olduğu için atlandı: ${res.skipped.join(', ')}`)
    const message = parts.join('; ')
    flash(message.charAt(0).toLocaleUpperCase('tr') + message.slice(1) + '.')
    await load()
    return true
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Odalar oluşturulamadı.'
    return false
  } finally {
    busy.value = false
  }
}

async function submitBulk() {
  if (await createRooms(bulk.roomType, bulkPreview.value?.numbers ?? [])) {
    Object.assign(bulk, { from: '', to: '' })
    showBulk.value = false
  }
}

async function submitQuick() {
  if (await createRooms(quick.roomType, [quick.roomNumber.trim()])) quick.roomNumber = ''
}

function genderShort(g: Gender) {
  return g === 'male' ? 'E' : 'K'
}

/** "Mehmet Ali Yılmaz" → "Mehmet Ali Y." (sıkışık görünüm için). */
function shortName(fullName: string) {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length < 2) return fullName
  const last = parts.pop()!
  return `${parts.join(' ')} ${last.charAt(0)}.`
}

onMounted(async () => {
  find<RoomType>('room-types', { limit: 0, sort: 'capacity' })
    .then((res) => {
      roomTypes.value = res.docs
      const first = res.docs.find((t) => t.active !== false)?.id ?? null
      bulk.roomType = first
      quick.roomType = first
    })
    .catch(() => undefined)
  await load()
})
</script>

<template>
  <section class="page">
    <div class="page-header">
      <h1>Oda Yerleşimi</h1>
      <div class="toolbar">
        <div class="stats" aria-label="Özet">
          <span
            ><strong>{{ stats.rooms }}</strong> oda</span
          >
          <span
            ><strong>{{ stats.occupied }}/{{ stats.beds }}</strong> yatak dolu</span
          >
          <span :class="{ warn: unassignedCount }"
            ><strong>{{ unassignedCount }}</strong> odasız</span
          >
        </div>
        <div class="segmented" role="group" aria-label="Görünüm">
          <button
            type="button"
            :class="{ on: density === 'compact' }"
            :aria-pressed="density === 'compact'"
            @click="density = 'compact'"
          >
            Sıkışık
          </button>
          <button
            type="button"
            :class="{ on: density === 'comfortable' }"
            :aria-pressed="density === 'comfortable'"
            @click="density = 'comfortable'"
          >
            Geniş
          </button>
        </div>
        <button
          class="btn btn-primary"
          :disabled="!activeRoomTypes.length"
          @click="showBulk = !showBulk"
        >
          Toplu oda ekle
        </button>
      </div>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">
      {{ error }}
      <button type="button" class="alert-close" aria-label="Kapat" @click="error = ''">×</button>
    </div>
    <p v-if="!roomTypes.length && !loading" class="alert alert-error">
      Oda eklemek için önce bir oda tipi tanımlayın.
    </p>

    <form v-if="showBulk" class="card form bulk" @submit.prevent="submitBulk">
      <h2>Toplu oda ekle</h2>
      <div class="bulk-grid">
        <label class="field">
          <span>Oda tipi</span>
          <select v-model="bulk.roomType" required>
            <option v-for="t in activeRoomTypes" :key="t.id" :value="t.id">
              {{ t.name }} ({{ t.capacity }} kişi)
            </option>
          </select>
        </label>
        <label class="field">
          <span>Önek (isteğe bağlı)</span>
          <input v-model="bulk.prefix" placeholder="A-" />
        </label>
        <label class="field">
          <span>İlk numara</span>
          <input v-model.trim="bulk.from" inputmode="numeric" required placeholder="101" />
        </label>
        <label class="field">
          <span>Son numara</span>
          <input v-model.trim="bulk.to" inputmode="numeric" required placeholder="120" />
        </label>
      </div>
      <p v-if="bulkPreview?.error" class="hint error-text">{{ bulkPreview.error }}</p>
      <p v-else-if="bulkPreviewText" class="hint muted">{{ bulkPreviewText }}</p>
      <p class="hint muted">Aynı numarada zaten oda varsa atlanır.</p>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" @click="showBulk = false">Vazgeç</button>
        <button
          type="submit"
          class="btn btn-primary"
          :disabled="busy || !bulkPreview?.numbers.length"
        >
          {{
            bulkPreview?.numbers.length ? `${bulkPreview.numbers.length} oda oluştur` : 'Oluştur'
          }}
        </button>
      </div>
    </form>

    <p v-if="loading && !rooms.length" class="card empty-state">Yükleniyor…</p>

    <div v-else class="board" :class="density">
      <aside
        class="card pool"
        :class="{ 'drop-target': drag.over === 'pool' }"
        aria-label="Umreciler"
        @dragover="onPoolDragOver"
        @dragleave="onDragLeave($event, 'pool')"
        @drop.prevent="onPoolDrop"
      >
        <div class="pool-head">
          <div class="segmented full" role="tablist" aria-label="Liste">
            <button
              type="button"
              role="tab"
              :class="{ on: poolMode === 'all' }"
              :aria-selected="poolMode === 'all'"
              @click="poolMode = 'all'"
            >
              Tümü ({{ pilgrims.length }})
            </button>
            <button
              type="button"
              role="tab"
              :class="{ on: poolMode === 'unassigned' }"
              :aria-selected="poolMode === 'unassigned'"
              @click="poolMode = 'unassigned'"
            >
              Odasız ({{ unassignedCount }})
            </button>
          </div>
          <input
            v-model="search"
            type="search"
            placeholder="İsim veya oda no ara…"
            aria-label="İsim veya oda numarası ara"
          />
          <div class="pool-filters">
            <select v-model="regionFilter" aria-label="Bölgeye göre filtrele">
              <option value="">Tüm bölgeler</option>
              <option v-for="r in regions" :key="r.id" :value="r.id">{{ r.name }}</option>
            </select>
            <select v-model="genderFilter" aria-label="Cinsiyete göre filtrele">
              <option value="">E + K</option>
              <option value="male">Erkek</option>
              <option value="female">Kadın</option>
            </select>
          </div>
          <label v-if="filteredPilgrims.length" class="check-row select-all">
            <input type="checkbox" :checked="allFilteredSelected" @change="toggleAll" />
            <span>Listedekilerin tümünü seç</span>
          </label>
        </div>

        <div v-if="draggingAssigned" class="pool-drop-hint">
          Odadan çıkarmak için buraya bırakın
        </div>

        <ul class="pool-list">
          <li
            v-for="p in filteredPilgrims"
            :key="p.id"
            class="pool-item"
            :class="{ selected: selected.has(p.id), dragging: drag.ids.includes(p.id) }"
            draggable="true"
            @dragstart="onDragStart($event, p)"
            @dragend="onDragEnd"
            @mouseenter="hoverRoom = p.room"
            @mouseleave="hoverRoom = null"
          >
            <input
              type="checkbox"
              :checked="selected.has(p.id)"
              :aria-label="`${p.fullName} seç`"
              @change="toggle(p.id)"
            />
            <span class="gender" :class="p.gender" :title="GENDER_LABELS[p.gender]">
              {{ genderShort(p.gender) }}
            </span>
            <span class="who">
              <span class="name"
                >{{ p.fullName }}<span v-if="p.infant" class="infant-tag">bebek</span></span
              >
              <span class="muted region"
                >{{ p.region?.name ?? '—'
                }}<template v-if="p.age !== null"> · {{ p.age }} yaş</template
                ><span
                  v-if="p.paymentGroup"
                  class="group-tag"
                  :title="`Ödeme grubu: ${p.paymentGroup.name}`"
                  >{{ p.paymentGroup.name }}</span
                ></span
              >
            </span>
            <button
              v-if="p.room !== null"
              type="button"
              class="room-chip"
              :title="`Oda ${roomNumberOf(p)} — odayı göster`"
              @click="locateRoom(p.room)"
            >
              {{ roomNumberOf(p) }}
            </button>
            <span v-else class="room-chip none">Odasız</span>
          </li>
        </ul>
        <p v-if="!filteredPilgrims.length" class="empty-state">
          {{
            poolMode === 'unassigned' && !unassignedCount
              ? 'Herkes bir odaya yerleşti.'
              : 'Eşleşen kişi yok.'
          }}
        </p>

        <div v-if="selected.size" class="selection-bar">
          <span
            ><strong>{{ selected.size }}</strong> seçili</span
          >
          <button
            v-if="selectedAssignedCount"
            type="button"
            class="btn btn-secondary btn-sm"
            :disabled="busy"
            @click="unassignSelected"
          >
            Odadan çıkar
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            :disabled="busy"
            @click="groupFormOpen = !groupFormOpen"
          >
            Ödeme grubu oluştur
          </button>
          <button type="button" class="btn btn-secondary btn-sm" @click="clearSelection">
            Temizle
          </button>
        </div>
        <form
          v-if="selected.size && groupFormOpen"
          class="group-form"
          @submit.prevent="createGroupFromSelection"
        >
          <input
            v-model="groupName"
            type="text"
            placeholder="Grup adı, ör. Yılmaz Ailesi"
            aria-label="Ödeme grubu adı"
            required
          />
          <button
            type="submit"
            class="btn btn-primary btn-sm"
            :disabled="busy || !groupName.trim()"
          >
            Oluştur
          </button>
          <button type="button" class="btn btn-secondary btn-sm" @click="groupFormOpen = false">
            Vazgeç
          </button>
        </form>
      </aside>

      <div class="rooms-area">
        <div class="rooms-toolbar">
          <input
            v-model="roomSearch"
            type="search"
            placeholder="Oda no…"
            aria-label="Oda numarası ara"
            class="room-search"
          />
          <select v-model="roomTypeFilter" aria-label="Oda tipine göre filtrele">
            <option value="">Tüm oda tipleri</option>
            <option v-for="t in roomTypes" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
          <label class="check-row">
            <input v-model="onlyFree" type="checkbox" />
            <span>Boş yeri olanlar</span>
          </label>
          <span class="legend" aria-hidden="true">
            <i class="dot empty" />Boş <i class="dot partial" />Kısmen <i class="dot full" />Dolu
          </span>
        </div>

        <p v-if="selected.size" class="selection-hint">
          {{ selected.size }} kişi seçili — odadaki <strong>+</strong> düğmesine basın ya da
          sürükleyip bırakın.
        </p>

        <div class="rooms-scroll">
          <div class="room-grid">
            <article
              v-for="room in visibleRooms"
              :key="room.id"
              :data-room-id="room.id"
              class="room"
              :class="{
                inactive: !isAssignable(room),
                empty: isAssignable(room) && occupantsOf(room).length === 0,
                partial: isAssignable(room) && freeOf(room) > 0 && occupantsOf(room).length > 0,
                full: isAssignable(room) && freeOf(room) === 0,
                'drop-target': drag.over === room.id,
                highlighted: hoverRoom === room.id || locatedRoom === room.id,
              }"
              @dragover="onRoomDragOver($event, room)"
              @dragleave="onDragLeave($event, room.id)"
              @drop.prevent="onRoomDrop(room)"
            >
              <header class="room-head">
                <strong class="room-no">{{ room.roomNumber }}</strong>
                <span class="room-type" :title="room.roomType?.name">{{
                  room.roomType?.name ?? '—'
                }}</span>
                <span v-if="isMixed(room)" class="mixed" title="Kadın ve erkek birlikte">⚥</span>
                <span class="occupancy"
                  >{{ bedsTaken(occupantsOf(room)) }}/{{ room.capacity
                  }}<template v-if="infantsOf(room)"> +{{ infantsOf(room) }} bebek</template></span
                >
                <button
                  v-if="selected.size && canTakeSelection(room)"
                  type="button"
                  class="assign"
                  :disabled="busy"
                  :title="`Seçilenleri Oda ${room.roomNumber}'e ata`"
                  :aria-label="`Seçilenleri Oda ${room.roomNumber}'e ata`"
                  @click="assignSelected(room)"
                >
                  +
                </button>
              </header>
              <p v-if="!isAssignable(room)" class="inactive-note">Pasif</p>

              <ul class="beds">
                <li
                  v-for="p in occupantsOf(room)"
                  :key="p.id"
                  class="bed occupied"
                  :class="{
                    selected: selected.has(p.id),
                    dragging: drag.ids.includes(p.id),
                    infant: p.infant,
                  }"
                  draggable="true"
                  :title="`${p.fullName}${p.age !== null ? ` · ${p.age} yaş` : ''} · ${p.region?.name ?? 'bölge yok'}${p.infant ? ' · bebek, yatak tutmaz' : ''}${p.paymentGroup ? ` · ödeme grubu: ${p.paymentGroup.name}` : ''}`"
                  @dragstart="onDragStart($event, p)"
                  @dragend="onDragEnd"
                >
                  <span class="gender" :class="p.gender">{{ genderShort(p.gender) }}</span>
                  <span class="name">{{
                    density === 'compact' ? shortName(p.fullName) : p.fullName
                  }}</span>
                  <span v-if="p.infant" class="infant-tag">bebek</span>
                  <span v-if="p.paymentGroup && density !== 'compact'" class="group-tag">{{
                    p.paymentGroup.name
                  }}</span>
                  <button
                    type="button"
                    class="remove"
                    :disabled="busy"
                    :aria-label="`${p.fullName} odadan çıkar`"
                    @click="move(null, [p.id])"
                  >
                    ×
                  </button>
                </li>
                <li v-for="n in freeOf(room)" :key="`free-${n}`" class="bed free">
                  <span v-if="density === 'comfortable'">boş</span>
                </li>
              </ul>
            </article>

            <form
              v-if="activeRoomTypes.length"
              class="room quick-add"
              @submit.prevent="submitQuick"
            >
              <strong>+ Oda ekle</strong>
              <input
                v-model="quick.roomNumber"
                required
                placeholder="Oda no"
                aria-label="Yeni oda numarası"
              />
              <select v-model="quick.roomType" required aria-label="Yeni oda tipi">
                <option v-for="t in activeRoomTypes" :key="t.id" :value="t.id">
                  {{ t.name }} ({{ t.capacity }})
                </option>
              </select>
              <button type="submit" class="btn btn-primary btn-sm" :disabled="busy">Ekle</button>
            </form>
          </div>

          <p v-if="rooms.length && !visibleRooms.length" class="empty-state">
            Filtreye uyan oda yok.
          </p>
        </div>
      </div>
    </div>

    <Transition name="toast">
      <div v-if="notice" class="toast" role="status">{{ notice }}</div>
    </Transition>
  </section>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}

.stats {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  font-size: 0.875rem;
  color: var(--color-muted);
}

.stats strong {
  color: var(--color-heading);
  font-variant-numeric: tabular-nums;
}

.stats .warn strong {
  color: var(--color-warning);
}

.segmented {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--color-surface);
}

.segmented.full {
  display: flex;
}

.segmented.full button {
  flex: 1;
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

.alert,
.bulk {
  margin-bottom: 1rem;
}

.alert {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.alert-close {
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 1.1rem;
  cursor: pointer;
}

.bulk h2 {
  font-size: 1.125rem;
}

.bulk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.75rem;
}

.hint {
  font-size: 0.875rem;
  margin: 0;
}

.error-text {
  color: var(--color-error);
}

select,
input[type='search'],
.quick-add input {
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: 0.875rem;
  min-width: 0;
}

/* İki sütun ekran yüksekliğini doldurur ve kendi içinde kayar: liste ve odalar hep birlikte görünür. */
.board {
  display: grid;
  grid-template-columns: minmax(260px, 300px) 1fr;
  gap: 1rem;
  height: calc(100vh - 10rem);
  min-height: 420px;
}

/* ---------- Sol panel ---------- */

.pool {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
  min-height: 0;
}

.pool-head {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  border-bottom: 1px solid var(--color-border);
}

.pool-filters {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.5rem;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  min-width: 0;
}

.select-all {
  font-size: 0.8125rem;
  color: var(--color-muted);
}

.pool-list {
  list-style: none;
  margin: 0;
  padding: 0.25rem 0;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.pool-item {
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.75rem;
  cursor: grab;
}

.pool-item:hover {
  background: var(--color-hover);
}

.pool-item.selected {
  background: var(--color-primary-soft);
}

.who {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
}

.who .name {
  font-size: 0.875rem;
}

.who .region {
  font-size: 0.75rem;
}

.room-chip {
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  border-radius: 999px;
  padding: 0.05rem 0.5rem;
  font: inherit;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  cursor: pointer;
}

.room-chip:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.room-chip.none {
  border-color: transparent;
  background: var(--color-warning-soft);
  color: var(--color-warning);
  cursor: default;
}

.pool-drop-hint {
  /* Katman olarak çıkar: sürükleme başlarken listeyi kaydırırsa Chrome sürüklemeyi iptal eder. */
  position: absolute;
  inset: auto 0.75rem 0.75rem;
  z-index: 1;
  padding: 1rem 0.75rem;
  border: 2px dashed var(--color-primary);
  border-radius: var(--radius);
  background: var(--color-surface);
  text-align: center;
  font-size: 0.875rem;
  color: var(--color-primary);
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.12);
  pointer-events: none;
}

.selection-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--color-border);
  background: var(--color-primary-soft);
  font-size: 0.875rem;
}

.selection-bar span {
  flex: 1;
}

/* ---------- Odalar ---------- */

.rooms-area {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.rooms-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  align-items: center;
  margin-bottom: 0.5rem;
  font-size: 0.875rem;
}

.room-search {
  width: 7rem;
}

.legend {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--color-muted);
  font-size: 0.75rem;
}

.legend .dot {
  display: inline-block;
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 2px;
  margin-left: 0.4rem;
}

.dot.empty {
  background: var(--color-success);
}

.dot.partial {
  background: var(--color-warning);
}

.dot.full {
  background: var(--color-error);
}

.selection-hint {
  margin: 0 0 0.5rem;
  padding: 0.35rem 0.6rem;
  border-radius: var(--radius);
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: 0.8125rem;
}

.rooms-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 4px 1rem 2px;
}

.room-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.75rem;
  align-items: start;
}

.compact .room-grid {
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.5rem;
  /* Satırdaki kartlar eşit boyda: 3 ve 4 kişilik odalar yan yana düzgün hizalanır. */
  align-items: stretch;
}

.room {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.6rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-top: 4px solid var(--color-success);
  border-radius: var(--radius);
  outline: 2px solid transparent;
  outline-offset: 1px;
  transition:
    outline-color 0.12s,
    background-color 0.12s;
}

.compact .room {
  gap: 0.25rem;
  padding: 0.4rem 0.45rem;
  border-top-width: 3px;
}

.room.partial {
  border-top-color: var(--color-warning);
}

.room.full {
  border-top-color: var(--color-error);
}

.room.inactive {
  border-top-color: var(--color-border);
  opacity: 0.55;
}

.room.highlighted {
  outline-color: var(--color-warning);
}

.room.drop-target {
  outline-color: var(--color-primary);
  background: var(--color-primary-soft);
}

.room-head {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
}

.room-no {
  font-size: 0.9375rem;
  white-space: nowrap;
}

.compact .room-no {
  font-size: 0.875rem;
}

.room-type {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-muted);
  font-size: 0.75rem;
}

.mixed {
  color: var(--color-warning);
  font-size: 0.8125rem;
}

.occupancy {
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: var(--color-muted);
}

.assign {
  border: 0;
  border-radius: 999px;
  width: 1.4rem;
  height: 1.4rem;
  background: var(--color-primary);
  color: var(--color-on-primary);
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
}

.inactive-note {
  margin: 0;
  font-size: 0.75rem;
  color: var(--color-muted);
}

.beds {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.bed {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 1.9rem;
  padding: 0.2rem 0.35rem;
  border-radius: calc(var(--radius) - 2px);
  font-size: 0.8125rem;
}

.compact .bed {
  min-height: 1.45rem;
  padding: 0.1rem 0.25rem;
  font-size: 0.75rem;
  gap: 0.25rem;
}

.bed.occupied {
  background: var(--color-hover);
  cursor: grab;
}

.bed.occupied.infant {
  outline: 1px dashed var(--color-border);
  outline-offset: -1px;
}

.group-tag {
  display: inline-block;
  max-width: 9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
  margin-left: 0.35rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  background: var(--color-warning-soft);
  color: var(--color-warning);
  white-space: nowrap;
}

.group-form {
  display: flex;
  gap: 0.375rem;
  padding: 0.5rem 0.75rem;
  background: var(--color-primary-soft);
}

.group-form input {
  flex: 1;
  min-width: 0;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: 0.875rem;
}

.infant-tag {
  margin-left: 0.35rem;
  padding: 0 0.3rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  background: var(--color-primary-soft);
  white-space: nowrap;
}

.bed.occupied.selected {
  background: var(--color-primary-soft);
}

.bed .name {
  flex: 1;
  min-width: 0;
}

.bed.free {
  border: 1px dashed var(--color-border);
  color: var(--color-muted);
  justify-content: center;
}

.compact .bed.free {
  min-height: 1.45rem;
}

.dragging {
  opacity: 0.4;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gender {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.3rem;
  height: 1.3rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 700;
  flex-shrink: 0;
}

.compact .bed .gender {
  width: 1.05rem;
  height: 1.05rem;
  font-size: 0.625rem;
}

.gender.male {
  background: var(--color-primary-soft);
  color: var(--color-primary);
}

.gender.female {
  background: var(--color-warning-soft);
  color: var(--color-warning);
}

.remove {
  border: 0;
  background: transparent;
  color: var(--color-muted);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.15rem;
  opacity: 0;
}

.bed:hover .remove,
.remove:focus-visible {
  opacity: 1;
}

.remove:hover:not(:disabled) {
  color: var(--color-error);
}

.quick-add {
  border-style: dashed;
  border-top: 1px dashed var(--color-primary);
}

.quick-add strong {
  font-size: 0.875rem;
}

/* ---------- Bildirim ---------- */

.toast {
  position: fixed;
  right: 1.5rem;
  bottom: 1.5rem;
  z-index: 10;
  max-width: min(420px, calc(100vw - 2rem));
  padding: 0.65rem 1rem;
  border-radius: var(--radius);
  background: var(--color-heading);
  color: var(--color-surface);
  font-size: 0.875rem;
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.18);
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.2s,
    transform 0.2s;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(0.5rem);
}

@media (hover: none) {
  .remove {
    opacity: 1;
  }

  .remove {
    min-width: 1.75rem;
    min-height: 1.75rem;
  }

  .assign {
    width: 1.9rem;
    height: 1.9rem;
  }
}

@media (max-width: 900px) {
  .board {
    grid-template-columns: 1fr;
    height: auto;
  }

  .pool {
    max-height: 50vh;
  }

  .rooms-scroll {
    overflow: visible;
  }

  .legend {
    margin-left: 0;
  }
}
</style>
