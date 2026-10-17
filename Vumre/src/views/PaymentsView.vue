<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { listCashboxes } from '@/api/cashboxes'
import { createPayment, deletePayment, getAccounts, listPayments } from '@/api/payments'
import type {
  AccountBalance,
  Cashbox,
  Payment,
  Pilgrim,
  PilgrimBalance,
  User,
} from '@/types/payload'
import { CURRENCIES, formatDate, formatMoney } from '@/utils/accommodation'
import { CASHBOX_KIND_LABELS } from '@/utils/cash'
import {
  BALANCE_STATUS_BADGE,
  BALANCE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  convertFromDebt,
  payableCurrencies,
  todayInputValue,
} from '@/utils/payments'

interface FormState {
  payer: number | null
  currency: string
  amount: number | null
  paidAt: string
  cashbox: number | null
  receiptNo: string
  note: string
}

interface Suggestion {
  key: string
  account: AccountBalance
  member: PilgrimBalance | null
}

const MAX_SUGGESTIONS = 8
const CASHBOX_MEMORY_KEY = 'vumre.paymentCashbox.'

const route = useRoute()
const router = useRouter()

const accounts = ref<AccountBalance[]>([])
const cashboxes = ref<Cashbox[]>([])
const history = ref<Payment[]>([])
const recent = ref<Payment[]>([])
const search = ref('')
const loading = ref(false)
const historyLoading = ref(false)
const saving = ref(false)
const error = ref('')
const success = ref('')

/** `currency` cinsinden aktif kasalar. */
function cashboxesIn(currency: string | null | undefined) {
  return cashboxes.value.filter((c) => c.active !== false && c.currency === currency)
}

/** Para birimi için son kullanılan kasa; yoksa o dövizdeki ilk aktif kasa. */
function pickCashbox(currency: string | null | undefined) {
  const options = cashboxesIn(currency)
  let remembered: number | null = null
  try {
    remembered = Number(localStorage.getItem(CASHBOX_MEMORY_KEY + currency)) || null
  } catch {
    remembered = null
  }
  return (options.find((c) => c.id === remembered) ?? options[0])?.id ?? null
}

function rememberCashbox(currency: string, id: number) {
  try {
    localStorage.setItem(CASHBOX_MEMORY_KEY + currency, String(id))
  } catch {
    // Tarayıcı depolaması kapalıysa yalnızca hatırlanmaz.
  }
}

/** Odası belli olmayan, ilk ön ödemesi alınacak hesabın varsayılan para birimi. */
function defaultAdvanceCurrency() {
  return cashboxes.value.find((c) => c.active !== false)?.currency ?? CURRENCIES[0] ?? 'USD'
}

const emptyForm = (account?: AccountBalance | null): FormState => ({
  payer: account?.contact ? Number(account.contact.pilgrimId) : null,
  currency: account?.currency ?? (account ? defaultAdvanceCurrency() : ''),
  amount: account && account.balance > 0 ? account.balance : null,
  paidAt: todayInputValue(),
  cashbox: pickCashbox(account?.currency),
  receiptNo: '',
  note: '',
})
const form = reactive<FormState>(emptyForm())

const routeGroup = computed(() => Number(route.query.group) || null)
const routePilgrim = computed(() => Number(route.query.pilgrim) || null)

/** Adres çubuğundaki `?group=` veya `?pilgrim=` hesabı; kişi bir gruptaysa grubun hesabı. */
const selected = computed(() => {
  if (routeGroup.value) {
    return accounts.value.find((a) => Number(a.groupId) === routeGroup.value) ?? null
  }
  if (routePilgrim.value) {
    return accounts.value.find((a) => a.members.some((m) => m.id === routePilgrim.value)) ?? null
  }
  return null
})

const isGroup = computed(() => selected.value?.kind === 'group')

/** Kişi adı, TC, pasaport, telefon, oda veya grup adıyla arama. */
const suggestions = computed<Suggestion[]>(() => {
  const term = search.value.trim().toLocaleLowerCase('tr-TR')
  if (!term) return []
  const hit = (values: (string | null | undefined)[]) =>
    values.some((v) => v?.toLocaleLowerCase('tr-TR').includes(term))
  const list: Suggestion[] = []
  for (const account of accounts.value) {
    if (account.kind === 'group' && hit([account.name])) {
      list.push({ key: account.key, account, member: null })
    }
    for (const m of account.members) {
      if (hit([m.fullName, m.tcNo, m.passportNo, m.phone, m.room?.roomNumber])) {
        list.push({ key: `${account.key}:${m.id}`, account, member: m })
      }
    }
  }
  return list.slice(0, MAX_SUGGESTIONS)
})

/** Odası (grupta kimsenin odası) belli değil: tahsilat ön ödeme olarak alınır. */
const isAdvance = computed(() => !!selected.value && selected.value.price == null)

const canCollect = computed(
  () => isAdvance.value || (!!selected.value?.price && selected.value.balance > 0),
)

/** Ödeme alınabilecek para birimleri; ilki borcun para birimi. */
const payable = computed(() => (selected.value ? payableCurrencies(selected.value) : []))

/**
 * Formda seçilebilecek para birimleri. Ön ödemede önceki ödemelerin para birimi (yoksa hepsi);
 * borçta oda tipinde fiyatı girilmiş olanlar.
 */
const currencyOptions = computed<string[]>(() => {
  if (!isAdvance.value) return payable.value.map((c) => c.currency)
  return selected.value?.currency ? [selected.value.currency] : [...CURRENCIES]
})

/** Kalan borcun `currency` cinsinden karşılığı (oda ücretlerinin oranıyla). */
function remainingIn(currency: string) {
  const account = selected.value
  if (!account || account.balance <= 0) return null
  return convertFromDebt(account.balance, account, currency)
}

const formRemaining = computed(() => remainingIn(form.currency))

/** Formdaki para birimindeki aktif kasalar. */
const formCashboxes = computed(() => cashboxesIn(form.currency || selected.value?.currency))

/** Kalan borcun diğer para birimlerindeki karşılıkları ("460 EUR · 17.500 TRY"). */
const remainingOthers = computed(() =>
  payable.value
    .slice(1)
    .map((c) => formatMoney(remainingIn(c.currency), c.currency))
    .join(' · '),
)

/** Borçtan düşülen tutar, ödemenin para biriminden farklıysa gösterilir. */
function debtNote(p: Payment) {
  if (!p.debtCurrency || p.debtCurrency === p.currency || p.debtAmount == null) return ''
  return `borçtan ${formatMoney(p.debtAmount, p.debtCurrency)}`
}

const memberIds = computed(() => selected.value?.members.map((m) => m.id) ?? [])

function pilgrimName(p: Payment) {
  return typeof p.pilgrim === 'object' ? (p.pilgrim as Pilgrim).fullName : null
}

function pilgrimIdOf(p: Payment) {
  return typeof p.pilgrim === 'object' ? p.pilgrim.id : p.pilgrim
}

/** Tahsilatın girdiği kasa; kasa yüklenmemişse ödeme şekli. */
function cashboxOf(p: Payment) {
  if (p.cashbox && typeof p.cashbox === 'object') return p.cashbox.name
  return cashboxes.value.find((c) => c.id === p.cashbox)?.name ?? PAYMENT_METHOD_LABELS[p.method]
}

function receiverOf(p: Payment) {
  return p.receivedBy && typeof p.receivedBy === 'object' ? (p.receivedBy as User).email : '—'
}

function accountQuery(account: AccountBalance) {
  return account.kind === 'group'
    ? { group: String(account.groupId) }
    : { pilgrim: String(account.members[0]!.id) }
}

async function loadAccounts() {
  loading.value = true
  try {
    accounts.value = await getAccounts()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Borç bilgileri yüklenemedi.'
  } finally {
    loading.value = false
  }
}

async function loadCashboxes() {
  try {
    cashboxes.value = await listCashboxes()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Kasalar yüklenemedi.'
  }
}

async function loadRecent() {
  try {
    recent.value = await listPayments(undefined, 20)
  } catch {
    recent.value = []
  }
}

async function loadHistory() {
  if (!memberIds.value.length) {
    history.value = []
    return
  }
  historyLoading.value = true
  try {
    history.value = await listPayments(memberIds.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Tahsilatlar yüklenemedi.'
  } finally {
    historyLoading.value = false
  }
}

/** Kaydet / sil sonrası yalnızca seçili hesabın özetini tazeler. */
async function refreshSelected() {
  const current = selected.value
  if (!current) return
  const [fresh] = await getAccounts(
    current.kind === 'group'
      ? { group: Number(current.groupId) }
      : { pilgrim: Number(current.members[0]!.id) },
  )
  const i = accounts.value.findIndex((a) => a.key === current.key)
  if (fresh && i >= 0) accounts.value[i] = fresh
}

function select(account: AccountBalance | null) {
  search.value = ''
  success.value = ''
  router.replace({ query: account ? accountQuery(account) : {} })
}

function openPilgrim(id: number) {
  search.value = ''
  success.value = ''
  router.replace({ query: { pilgrim: String(id) } })
}

async function save() {
  const current = selected.value
  if (!current || form.amount === null || form.payer === null || form.cashbox === null) return
  const currency = form.currency || current.currency!
  saving.value = true
  error.value = ''
  success.value = ''
  try {
    await createPayment({
      pilgrim: form.payer,
      amount: form.amount,
      currency: form.currency || null,
      cashbox: form.cashbox,
      // Gün ortası (UTC) yazılır; saat dilimi farkıyla tarih bir gün kaymaz.
      paidAt: `${form.paidAt}T12:00:00.000Z`,
      receiptNo: form.receiptNo.trim() || null,
      note: form.note.trim() || null,
    })
    rememberCashbox(currency, form.cashbox)
    const box = cashboxes.value.find((c) => c.id === form.cashbox)
    success.value = `${current.name} için ${formatMoney(form.amount, currency)} tahsil edildi${box ? ` (${box.name})` : ''}.`
    await Promise.all([refreshSelected(), loadRecent()])
    await loadHistory()
    Object.assign(form, emptyForm(selected.value))
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Tahsilat kaydedilemedi.'
  } finally {
    saving.value = false
  }
}

async function destroy(payment: Payment) {
  const text = `${formatDate(payment.paidAt)} tarihli ${formatMoney(payment.amount, payment.currency)} tahsilat silinsin mi?`
  if (!confirm(text)) return
  error.value = ''
  success.value = ''
  try {
    await deletePayment(payment.id)
    if (selected.value) {
      await Promise.all([refreshSelected(), loadRecent()])
      await loadHistory()
      form.amount = formRemaining.value
    } else {
      // Son tahsilatlar listesinden silindi: ilgili hesabın özeti de değişti.
      await Promise.all([loadAccounts(), loadRecent()])
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Silinemedi.'
  }
}

// Para birimi değişince önerilen tutar o para birimindeki kalan borç, kasa da o dövizin kasası olur.
watch(
  () => form.currency,
  () => {
    form.amount = formRemaining.value
    form.cashbox = pickCashbox(form.currency || selected.value?.currency)
  },
)

watch(
  () => selected.value?.key,
  async () => {
    Object.assign(form, emptyForm(selected.value))
    await loadHistory()
  },
)

onMounted(async () => {
  await Promise.all([loadAccounts(), loadRecent(), loadCashboxes()])
  // Hesaplar ve kasalar yüklenince form yeniden kurulur (ön ödemede varsayılan para birimi
  // kasalardan gelir).
  if (selected.value) Object.assign(form, emptyForm(selected.value))
})
</script>

<template>
  <section>
    <div class="page-header">
      <h1>Tahsilat</h1>
      <div class="search">
        <label class="field">
          <input
            v-model="search"
            type="search"
            placeholder="Umreci veya grup ara: ad, TC, telefon, oda…"
            aria-label="Umreci veya ödeme grubu ara"
            :disabled="loading"
          />
        </label>
        <ul v-if="suggestions.length" class="suggestions card" role="listbox">
          <li v-for="s in suggestions" :key="s.key">
            <button type="button" @click="select(s.account)">
              <span>
                <strong>{{ s.member ? s.member.fullName : s.account.name }}</strong>
                <small class="muted">
                  <template v-if="s.member">
                    {{ s.member.room ? `Oda ${s.member.room.roomNumber}` : 'Oda yok' }}
                    <template v-if="s.account.kind === 'group'">
                      · {{ s.account.name }} grubu</template
                    >
                    <template v-else-if="s.member.region"> · {{ s.member.region.name }}</template>
                  </template>
                  <template v-else>Ödeme grubu · {{ s.account.members.length }} kişi</template>
                </small>
              </span>
              <span class="badge" :class="BALANCE_STATUS_BADGE[s.account.status]">
                {{
                  s.account.balance > 0
                    ? formatMoney(s.account.balance, s.account.currency)
                    : BALANCE_STATUS_LABELS[s.account.status]
                }}
              </span>
            </button>
          </li>
        </ul>
        <p v-else-if="search.trim() && !loading" class="suggestions card muted">
          Eşleşen umreci veya grup yok.
        </p>
      </div>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
    <div v-if="success" class="alert alert-success" role="status">{{ success }}</div>

    <template v-if="selected">
      <div class="card summary">
        <div class="summary-head">
          <div>
            <p v-if="isGroup" class="eyebrow">Ödeme grubu · {{ selected.members.length }} kişi</p>
            <h2>{{ selected.name }}</h2>
            <p class="muted">
              <template v-if="isGroup">
                <template v-if="selected.hasResponsible && selected.contact">
                  Sorumlu: {{ selected.contact.fullName }}
                  <template v-if="selected.contact.phone"> · {{ selected.contact.phone }}</template>
                </template>
                <span v-else class="warn">Sorumlu kişi seçilmedi</span>
                <template v-if="selected.rooms.length">
                  · Odalar: {{ selected.rooms.join(', ') }}</template
                >
              </template>
              <template v-else>
                {{
                  selected.members[0]?.room
                    ? `Oda ${selected.members[0].room.roomNumber}`
                    : 'Odaya atanmadı'
                }}
                <template v-if="selected.regions.length"> · {{ selected.regions[0] }}</template>
                <template v-if="selected.contact?.phone"> · {{ selected.contact.phone }}</template>
              </template>
            </p>
          </div>
          <div class="summary-actions">
            <span class="badge" :class="BALANCE_STATUS_BADGE[selected.status]">
              {{ BALANCE_STATUS_LABELS[selected.status] }}
            </span>
            <RouterLink
              v-if="isGroup"
              :to="{ name: 'payment-groups', query: { group: String(selected.groupId) } }"
              class="btn btn-secondary btn-sm"
            >
              Grubu düzenle
            </RouterLink>
            <button class="btn btn-secondary btn-sm" @click="select(null)">Kapat</button>
          </div>
        </div>
        <dl class="stats">
          <div>
            <dt>{{ isGroup ? 'Toplam oda ücreti (borç)' : 'Oda ücreti (borç)' }}</dt>
            <dd>
              {{ isAdvance ? 'Oda belli değil' : formatMoney(selected.price, selected.currency) }}
            </dd>
          </div>
          <div>
            <dt>Ödenen</dt>
            <dd>{{ formatMoney(selected.paid, selected.currency) }}</dd>
          </div>
          <div>
            <dt>
              {{ isAdvance ? 'Ön ödeme' : selected.balance < 0 ? 'Fazla ödeme (iade)' : 'Kalan' }}
            </dt>
            <dd :class="{ due: selected.balance > 0, over: selected.balance < 0 && !isAdvance }">
              {{ formatMoney(Math.abs(selected.balance), selected.currency) }}
              <small v-if="selected.balance > 0 && remainingOthers" class="alt muted">
                = {{ remainingOthers }}
              </small>
            </dd>
          </div>
        </dl>

        <div v-if="isGroup" class="table-wrap members">
          <table class="table">
            <thead>
              <tr>
                <th>Üye</th>
                <th>Oda</th>
                <th class="num">Oda ücreti</th>
                <th class="num">Yaptığı ödeme</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in selected.members" :key="m.id">
                <td>
                  {{ m.fullName }}
                  <span
                    v-if="selected.contact && Number(selected.contact.pilgrimId) === m.id"
                    class="badge"
                    >Sorumlu</span
                  >
                </td>
                <td>{{ m.room ? m.room.roomNumber : '—' }}</td>
                <td class="num">{{ formatMoney(m.price, m.currency) }}</td>
                <td class="num">{{ m.paid ? formatMoney(m.paid, m.currency) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <form v-if="canCollect" class="card form" @submit.prevent="save">
        <h2>Tahsilat al</h2>
        <div class="form-grid">
          <label v-if="isGroup" class="field">
            <span>Ödeyen</span>
            <select v-model.number="form.payer" required>
              <option v-for="m in selected.members" :key="m.id" :value="m.id">
                {{ m.fullName }}
              </option>
            </select>
          </label>
          <label v-if="currencyOptions.length > 1" class="field">
            <span>Para birimi</span>
            <select v-model="form.currency">
              <option v-for="c in currencyOptions" :key="c" :value="c">{{ c }}</option>
            </select>
          </label>
          <label class="field">
            <span>Tutar ({{ form.currency }})</span>
            <input
              v-model.number="form.amount"
              type="number"
              min="0.01"
              step="0.01"
              :max="formRemaining ?? undefined"
              required
            />
          </label>
          <label class="field">
            <span>Ödeme tarihi</span>
            <input v-model="form.paidAt" type="date" required />
          </label>
          <label class="field">
            <span>Kasa</span>
            <select v-model.number="form.cashbox" required :disabled="!formCashboxes.length">
              <option v-for="c in formCashboxes" :key="c.id" :value="c.id">
                {{ c.name }} · {{ CASHBOX_KIND_LABELS[c.kind] }}
              </option>
            </select>
          </label>
          <label class="field">
            <span>Makbuz / dekont no</span>
            <input v-model="form.receiptNo" />
          </label>
          <label class="field span-all">
            <span>Not</span>
            <textarea v-model="form.note" rows="2" />
          </label>
        </div>
        <p
          v-if="!isAdvance && form.currency && form.currency !== selected.currency"
          class="muted small"
        >
          Kalan borç {{ formatMoney(formRemaining, form.currency) }}. {{ form.currency }} ödeme, oda
          ücretlerinin oranıyla {{ selected.currency }} borçtan düşülür.
        </p>
        <p v-if="isAdvance" class="muted small">
          {{ isGroup ? 'Grupta odaya atanmış kimse' : 'Umrecinin odası' }} henüz belli olmadığı için
          tahsilat <strong>ön ödeme</strong> olarak alınır; odaya atanınca oda ücretinden düşülür.
          <template v-if="selected.currency">
            Önceki ön ödemeler {{ selected.currency }} olduğundan aynı para biriminde alınır.
          </template>
        </p>
        <p v-if="isGroup && !isAdvance" class="muted small">
          Ödeme grubun toplam borcundan düşer; kişilere ayrıca dağıtılmaz.
        </p>
        <p v-if="!formCashboxes.length" class="small warn">
          {{ form.currency || selected.currency }} cinsinden aktif kasa yok; tahsilat için önce
          <RouterLink to="/kasa">Kasa</RouterLink> sayfasından kasa açın.
        </p>
        <div class="form-actions">
          <button
            v-if="!isAdvance"
            type="button"
            class="btn btn-secondary"
            :disabled="saving"
            @click="form.amount = formRemaining"
          >
            Kalanın tamamı
          </button>
          <button
            type="submit"
            class="btn btn-primary"
            :disabled="saving || !form.amount || !form.payer || !form.cashbox"
          >
            {{ saving ? 'Kaydediliyor…' : 'Tahsilatı kaydet' }}
          </button>
        </div>
      </form>
      <p v-else class="card muted notice">
        <template v-if="selected.balance < 0">
          Ödenen tutar oda ücretini aşıyor; fazla ödeme iade edilmeli veya tahsilat düzeltilmeli.
        </template>
        <template v-else>Borç kapanmış, alınacak tahsilat yok.</template>
      </p>

      <div class="card table-wrap">
        <h2>Ödeme geçmişi</h2>
        <p v-if="historyLoading" class="empty-state">Yükleniyor…</p>
        <p v-else-if="!history.length" class="empty-state">Henüz tahsilat yok.</p>
        <table v-else class="table">
          <thead>
            <tr>
              <th>Tarih</th>
              <th v-if="isGroup">Ödeyen</th>
              <th class="num">Tutar</th>
              <th>Kasa</th>
              <th>Makbuz no</th>
              <th>Not</th>
              <th>Tahsil eden</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in history" :key="p.id">
              <td>{{ formatDate(p.paidAt) }}</td>
              <td v-if="isGroup">{{ pilgrimName(p) || '—' }}</td>
              <td class="num">
                {{ formatMoney(p.amount, p.currency) }}
                <small v-if="debtNote(p)" class="alt muted">{{ debtNote(p) }}</small>
              </td>
              <td>{{ cashboxOf(p) }}</td>
              <td>{{ p.receiptNo || '—' }}</td>
              <td>{{ p.note || '—' }}</td>
              <td>{{ receiverOf(p) }}</td>
              <td class="actions">
                <button class="btn btn-danger btn-sm" @click="destroy(p)">Sil</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <div v-else class="card table-wrap">
      <h2>Son tahsilatlar</h2>
      <p class="muted hint">Tahsilat almak için yukarıdan umreci veya ödeme grubu arayın.</p>
      <p v-if="!recent.length" class="empty-state">Henüz tahsilat yok.</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Tarih</th>
            <th>Ödeyen</th>
            <th class="num">Tutar</th>
            <th>Kasa</th>
            <th>Makbuz no</th>
            <th>Tahsil eden</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in recent" :key="p.id">
            <td>{{ formatDate(p.paidAt) }}</td>
            <td>{{ pilgrimName(p) || '—' }}</td>
            <td class="num">
              {{ formatMoney(p.amount, p.currency) }}
              <small v-if="debtNote(p)" class="alt muted">{{ debtNote(p) }}</small>
            </td>
            <td>{{ cashboxOf(p) }}</td>
            <td>{{ p.receiptNo || '—' }}</td>
            <td>{{ receiverOf(p) }}</td>
            <td class="actions">
              <button class="btn btn-secondary btn-sm" @click="openPilgrim(pilgrimIdOf(p))">
                Aç
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.search {
  position: relative;
  width: min(100%, 420px);
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.625rem;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.suggestions button:hover,
.suggestions button:focus-visible {
  background: var(--color-hover);
}

.suggestions small {
  display: block;
}

.alert,
.card {
  margin-bottom: 1rem;
}

h2 {
  font-size: 1.125rem;
  margin-bottom: 0.75rem;
}

.eyebrow {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-primary);
  margin-bottom: 0.125rem;
}

.warn {
  color: var(--color-warning);
  font-weight: 500;
}

.summary-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  flex-wrap: wrap;
}

.summary-head h2 {
  margin-bottom: 0.125rem;
}

.summary-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1rem;
  margin: 1.25rem 0 0;
}

.stats dt {
  color: var(--color-muted);
  font-size: 0.8125rem;
}

.stats dd {
  margin: 0.25rem 0 0;
  font-size: 1.375rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.stats dd.due {
  color: var(--color-error);
}

.stats dd.over {
  color: var(--color-warning);
}

.members {
  margin-top: 1.25rem;
}

.alt {
  display: block;
  font-size: 0.8125rem;
  font-weight: 400;
}

.notice {
  padding: 1rem 1.5rem;
}

.small {
  font-size: 0.875rem;
}

.hint {
  margin: -0.5rem 0 0.75rem;
  font-size: 0.875rem;
}
</style>
