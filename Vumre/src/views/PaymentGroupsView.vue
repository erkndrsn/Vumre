<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { createGroup, deleteGroup, setGroupMembers, updateGroup } from '@/api/paymentGroups'
import { getAccounts } from '@/api/payments'
import type { AccountBalance, PilgrimBalance } from '@/types/payload'
import { formatMoney } from '@/utils/accommodation'
import { BALANCE_STATUS_BADGE, BALANCE_STATUS_LABELS } from '@/utils/payments'

interface FormState {
  name: string
  note: string
  responsible: number | null
  members: number[]
}

const MAX_SUGGESTIONS = 8

const route = useRoute()
const router = useRouter()

const accounts = ref<AccountBalance[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const success = ref('')
const search = ref('')
const memberSearch = ref('')
/** Düzenlenen grubun id'si; `'new'` yeni grup, null form kapalı. */
const editing = ref<number | 'new' | null>(null)

const emptyForm = (): FormState => ({ name: '', note: '', responsible: null, members: [] })
const form = reactive<FormState>(emptyForm())

const groups = computed(() => accounts.value.filter((a) => a.kind === 'group'))

const filteredGroups = computed(() => {
  const term = search.value.trim().toLocaleLowerCase('tr-TR')
  if (!term) return groups.value
  return groups.value.filter(
    (g) =>
      g.name.toLocaleLowerCase('tr-TR').includes(term) ||
      g.members.some((m) => m.fullName.toLocaleLowerCase('tr-TR').includes(term)),
  )
})

/** Tüm umreciler (gruptakiler dahil), id'ye göre. */
const pilgrimById = computed(() => {
  const map = new Map<number, PilgrimBalance>()
  for (const a of accounts.value) for (const m of a.members) map.set(Number(m.id), m)
  return map
})

const formMembers = computed(() =>
  form.members.map((id) => pilgrimById.value.get(id)).filter((m): m is PilgrimBalance => !!m),
)

const editingGroup = computed(() =>
  typeof editing.value === 'number'
    ? (groups.value.find((g) => Number(g.groupId) === editing.value) ?? null)
    : null,
)

/** Formdaki üyelerin para birimleri; birden fazlaysa kayıt sunucuda reddedilir. */
const formCurrencies = computed(() => [
  ...new Set(formMembers.value.map((m) => m.currency).filter(Boolean)),
])

const memberSuggestions = computed(() => {
  const term = memberSearch.value.trim().toLocaleLowerCase('tr-TR')
  if (!term) return []
  const chosen = new Set(form.members)
  return [...pilgrimById.value.values()]
    .filter(
      (p) =>
        !chosen.has(Number(p.id)) &&
        [p.fullName, p.tcNo, p.passportNo, p.phone, p.room?.roomNumber].some((v) =>
          v?.toLocaleLowerCase('tr-TR').includes(term),
        ),
    )
    .slice(0, MAX_SUGGESTIONS)
})

/** Başka bir grupta olan kişi bu gruba eklenemez. */
function otherGroupOf(p: PilgrimBalance) {
  if (!p.paymentGroup) return null
  return Number(p.paymentGroup.id) === editing.value ? null : p.paymentGroup.name
}

function addMember(p: PilgrimBalance) {
  if (otherGroupOf(p)) return
  form.members.push(Number(p.id))
  if (form.responsible === null && p.phone) form.responsible = Number(p.id)
  memberSearch.value = ''
}

function removeMember(id: number) {
  form.members = form.members.filter((m) => m !== id)
  if (form.responsible === id) form.responsible = null
}

async function load() {
  loading.value = true
  try {
    accounts.value = await getAccounts()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ödeme grupları yüklenemedi.'
  } finally {
    loading.value = false
  }
}

/** `?group=` değeri: "yeni" veya grup id'si. */
function openTarget(param: unknown) {
  if (param) success.value = ''
  memberSearch.value = ''
  if (param === 'yeni') {
    editing.value = 'new'
    Object.assign(form, emptyForm())
    return
  }
  const id = Number(param) || null
  const group = id ? groups.value.find((g) => Number(g.groupId) === id) : null
  if (!group) {
    editing.value = null
    return
  }
  editing.value = id
  Object.assign(form, {
    name: group.name,
    note: group.note ?? '',
    responsible: group.hasResponsible && group.contact ? Number(group.contact.pilgrimId) : null,
    members: group.members.map((m) => Number(m.id)),
  })
}

// Form tıklama anında açılır; adres çubuğu yalnızca bağlantı / yenileme içindir.
function openCreate() {
  openTarget('yeni')
  router.replace({ query: { group: 'yeni' } })
}

function openEdit(g: AccountBalance) {
  openTarget(String(g.groupId))
  router.replace({ query: { group: String(g.groupId) } })
}

function close() {
  editing.value = null
  router.replace({ query: {} })
}

/** Adres çubuğu dışarıdan değiştiyse (ör. Tahsilat'taki "Grubu düzenle") formu eşitler. */
function syncFromRoute() {
  const param = route.query.group
  const current =
    editing.value === 'new' ? 'yeni' : editing.value === null ? undefined : String(editing.value)
  if (param !== current) openTarget(param)
}

async function save() {
  saving.value = true
  error.value = ''
  success.value = ''
  const name = form.name.trim()
  const note = form.note.trim() || null
  try {
    if (editing.value === 'new') {
      await createGroup({ name, note, pilgrims: form.members, responsible: form.responsible })
      success.value = `${name} grubu oluşturuldu.`
    } else if (typeof editing.value === 'number' && editingGroup.value) {
      const before = new Set(editingGroup.value.members.map((m) => Number(m.id)))
      const after = new Set(form.members)
      const add = form.members.filter((id) => !before.has(id))
      const remove = [...before].filter((id) => !after.has(id))
      // Önce üyeler: sorumlu kişinin grubun üyesi olması gerekir.
      if (add.length || remove.length) await setGroupMembers(editing.value, { add, remove })
      await updateGroup(editing.value, { name, note, responsible: form.responsible })
      success.value = `${name} grubu kaydedildi.`
    }
    await load()
    close()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Kaydedilemedi.'
    // Üye değişikliği yazılıp ad / sorumlu yazılamadıysa ekrandaki liste güncel kalsın.
    await load()
  } finally {
    saving.value = false
  }
}

async function destroy(g: AccountBalance) {
  const text =
    `"${g.name}" grubu silinsin mi? ${g.members.length} üye tek kişilik takibe döner; ` +
    'yaptıkları ödemeler kendilerinde kalır.'
  if (!confirm(text)) return
  error.value = ''
  success.value = ''
  try {
    await deleteGroup(Number(g.groupId))
    success.value = `${g.name} grubu silindi.`
    if (editing.value === Number(g.groupId)) close()
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Silinemedi.'
  }
}

watch(() => route.query.group, syncFromRoute)

onMounted(async () => {
  await load()
  syncFromRoute()
})
</script>

<template>
  <section>
    <div class="page-header">
      <h1>Ödeme Grupları</h1>
      <div class="toolbar">
        <label class="field">
          <input v-model="search" type="search" placeholder="Grup veya üye ara…" />
        </label>
        <button class="btn btn-primary" @click="openCreate">Yeni grup</button>
      </div>
    </div>

    <p class="muted intro">
      Aile gibi birlikte ödeme yapan kişileri odalarından bağımsız olarak gruplayın. Grubun borcu
      üyelerin oda ücretleri toplamıdır; herhangi bir üyenin yaptığı ödeme bu toplamdan düşer.
    </p>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
    <div v-if="success" class="alert alert-success" role="status">{{ success }}</div>

    <form v-if="editing !== null" class="card form editor" @submit.prevent="save">
      <h2>{{ editing === 'new' ? 'Yeni ödeme grubu' : 'Grubu düzenle' }}</h2>
      <div class="form-grid">
        <label class="field">
          <span>Grup adı</span>
          <input v-model="form.name" required placeholder="Yılmaz Ailesi" />
        </label>
        <label class="field">
          <span>Sorumlu kişi</span>
          <select v-model="form.responsible" :disabled="!formMembers.length">
            <option :value="null">— Seçilmedi —</option>
            <option v-for="m in formMembers" :key="m.id" :value="Number(m.id)">
              {{ m.fullName }}{{ m.phone ? ` · ${m.phone}` : ' · telefon yok' }}
            </option>
          </select>
        </label>
        <label class="field span-all">
          <span>Not</span>
          <textarea v-model="form.note" rows="2" />
        </label>
      </div>

      <div class="members-editor">
        <h3>Üyeler ({{ formMembers.length }})</h3>
        <p v-if="formCurrencies.length > 1" class="alert alert-error">
          Üyelerin odaları farklı para birimlerinde ({{ formCurrencies.join(', ') }}). Bir grupta
          tek para birimi olabilir.
        </p>
        <ul v-if="formMembers.length" class="member-list">
          <li v-for="m in formMembers" :key="m.id">
            <span>
              <strong>{{ m.fullName }}</strong>
              <small class="muted">
                {{ m.room ? `Oda ${m.room.roomNumber}` : 'Oda yok' }}
                · {{ formatMoney(m.price, m.currency) }}
              </small>
            </span>
            <button
              type="button"
              class="btn btn-danger btn-sm"
              :aria-label="`${m.fullName} kişisini gruptan çıkar`"
              @click="removeMember(Number(m.id))"
            >
              Çıkar
            </button>
          </li>
        </ul>
        <p v-else class="muted small">Henüz üye eklenmedi.</p>

        <div class="member-search">
          <label class="field">
            <span>Üye ekle</span>
            <input
              v-model="memberSearch"
              type="search"
              placeholder="Ad, TC, telefon veya oda numarası…"
            />
          </label>
          <ul v-if="memberSuggestions.length" class="suggestions card">
            <li v-for="p in memberSuggestions" :key="p.id">
              <button type="button" :disabled="!!otherGroupOf(p)" @click="addMember(p)">
                <span>
                  <strong>{{ p.fullName }}</strong>
                  <small class="muted">
                    {{ p.room ? `Oda ${p.room.roomNumber}` : 'Oda yok' }}
                    <template v-if="p.region"> · {{ p.region.name }}</template>
                  </small>
                </span>
                <span v-if="otherGroupOf(p)" class="badge badge-warning">
                  {{ otherGroupOf(p) }} grubunda
                </span>
                <span v-else class="badge">{{ formatMoney(p.price, p.currency) }}</span>
              </button>
            </li>
          </ul>
          <p v-else-if="memberSearch.trim()" class="suggestions card muted">Eşleşen umreci yok.</p>
        </div>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" @click="close">Vazgeç</button>
        <button
          type="submit"
          class="btn btn-primary"
          :disabled="saving || !form.name.trim() || !form.members.length"
        >
          {{ saving ? 'Kaydediliyor…' : 'Kaydet' }}
        </button>
      </div>
    </form>

    <div class="card table-wrap">
      <p v-if="loading" class="empty-state">Yükleniyor…</p>
      <p v-else-if="!groups.length" class="empty-state">
        Henüz ödeme grubu yok. "Yeni grup" ile veya Oda Yerleşimi ekranında kişileri seçerek
        oluşturabilirsiniz.
      </p>
      <p v-else-if="!filteredGroups.length" class="empty-state">Eşleşen grup yok.</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Grup</th>
            <th>Sorumlu</th>
            <th class="num">Kişi</th>
            <th>Odalar</th>
            <th class="num">Toplam borç</th>
            <th class="num">Ödenen</th>
            <th class="num">Kalan</th>
            <th>Durum</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in filteredGroups" :key="g.key">
            <td>
              <strong>{{ g.name }}</strong>
              <small class="muted block">{{ g.members.map((m) => m.fullName).join(', ') }}</small>
            </td>
            <td>
              <span v-if="g.hasResponsible && g.contact">{{ g.contact.fullName }}</span>
              <span v-else class="warn">Seçilmedi</span>
            </td>
            <td class="num">{{ g.members.length }}</td>
            <td>{{ g.rooms.join(', ') || '—' }}</td>
            <td class="num">{{ formatMoney(g.price, g.currency) }}</td>
            <td class="num">{{ formatMoney(g.paid, g.currency) }}</td>
            <td class="num" :class="{ due: g.balance > 0, over: g.balance < 0 }">
              {{ formatMoney(g.balance, g.currency) }}
            </td>
            <td>
              <span class="badge" :class="BALANCE_STATUS_BADGE[g.status]">
                {{ BALANCE_STATUS_LABELS[g.status] }}
              </span>
            </td>
            <td class="actions">
              <RouterLink
                v-if="g.price"
                :to="{ name: 'payments', query: { group: String(g.groupId) } }"
                class="btn btn-primary btn-sm"
                >Tahsilat</RouterLink
              >
              <button class="btn btn-secondary btn-sm" @click="openEdit(g)">Düzenle</button>
              <button class="btn btn-danger btn-sm" @click="destroy(g)">Sil</button>
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
  flex-wrap: wrap;
}

.intro {
  margin: -0.5rem 0 1rem;
  font-size: 0.875rem;
  max-width: 70ch;
}

.alert,
.editor {
  margin-bottom: 1rem;
}

h2 {
  font-size: 1.125rem;
}

h3 {
  font-size: 0.9375rem;
  margin-bottom: 0.5rem;
}

.small {
  font-size: 0.875rem;
}

.block {
  display: block;
}

.warn {
  color: var(--color-warning);
}

.member-list {
  list-style: none;
  margin: 0 0 0.75rem;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  gap: 0.5rem;
}

.member-list li,
.suggestions button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.member-list li {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
}

.member-list small,
.suggestions small {
  display: block;
}

.member-search {
  position: relative;
  max-width: 420px;
}

.suggestions {
  position: absolute;
  z-index: 10;
  top: calc(100% + 0.25rem);
  left: 0;
  right: 0;
  list-style: none;
  margin: 0;
  padding: 0.25rem;
}

p.suggestions {
  padding: 0.75rem;
}

.suggestions button {
  width: 100%;
  padding: 0.5rem 0.625rem;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.suggestions button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.suggestions button:not(:disabled):hover,
.suggestions button:focus-visible {
  background: var(--color-hover);
}

.due {
  color: var(--color-error);
  font-weight: 600;
}

.over {
  color: var(--color-warning);
  font-weight: 600;
}

.table td.num {
  white-space: nowrap;
}

.actions > * + * {
  margin-left: 0.375rem;
}
</style>
