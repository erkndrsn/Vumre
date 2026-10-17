<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  createCashbox,
  createTransfer,
  deleteCashbox,
  deleteTransfer,
  getCashboxBalances,
  listTransfers,
  updateCashbox,
} from '@/api/cashboxes'
import { createExpense, deleteExpense, listExpenses } from '@/api/expenses'
import type {
  Cashbox,
  CashboxBalance,
  CashboxKind,
  CashTransfer,
  Currency,
  Expense,
  ExpenseCategory,
  User,
} from '@/types/payload'
import { CURRENCIES, formatDate, formatMoney } from '@/utils/accommodation'
import {
  CASHBOX_KIND_LABELS,
  CASHBOX_KIND_OPTIONS,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_CATEGORY_OPTIONS,
  totalsByCurrency,
} from '@/utils/cash'
import { roundMoney, todayInputValue } from '@/utils/payments'

interface ExpenseForm {
  description: string
  category: ExpenseCategory
  payee: string
  cashbox: number | null
  amount: number | null
  paidAt: string
  receiptNo: string
  note: string
}

interface TransferForm {
  from: number | null
  to: number | null
  amount: number | null
  toAmount: number | null
  transferredAt: string
  note: string
}

interface CashboxForm {
  id: number | null
  name: string
  currency: Currency
  kind: CashboxKind
  note: string
}

const balances = ref<CashboxBalance[]>([])
const expenses = ref<Expense[]>([])
const transfers = ref<CashTransfer[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const success = ref('')

const totals = computed(() => totalsByCurrency(balances.value.filter((b) => b.active)))
const activeBoxes = computed(() => balances.value.filter((b) => b.active))
const boxById = (id: number | null) => balances.value.find((b) => b.id === id)

// --- Kasa tanımı ---

const showCashboxForm = ref(false)
const emptyCashbox = (): CashboxForm => ({
  id: null,
  name: '',
  currency: 'USD',
  kind: 'cash',
  note: '',
})
const cashboxForm = reactive<CashboxForm>(emptyCashbox())

function openCashboxForm(box?: CashboxBalance) {
  Object.assign(
    cashboxForm,
    box
      ? { id: box.id, name: box.name, currency: box.currency, kind: box.kind, note: '' }
      : emptyCashbox(),
  )
  showCashboxForm.value = true
}

async function saveCashbox() {
  if (!cashboxForm.name.trim()) return
  await run(async () => {
    const data = {
      name: cashboxForm.name.trim(),
      currency: cashboxForm.currency,
      kind: cashboxForm.kind,
    }
    if (cashboxForm.id) {
      await updateCashbox(cashboxForm.id, data)
      success.value = `${data.name} güncellendi.`
    } else {
      await createCashbox({ ...data, note: cashboxForm.note.trim() || null })
      success.value = `${data.name} kasası açıldı.`
    }
    showCashboxForm.value = false
  }, 'Kasa kaydedilemedi.')
}

async function toggleActive(box: CashboxBalance) {
  await run(async () => {
    await updateCashbox(box.id, { active: !box.active })
    success.value = `${box.name} ${box.active ? 'pasif yapıldı' : 'yeniden aktif'}.`
  }, 'Kasa güncellenemedi.')
}

async function destroyCashbox(box: CashboxBalance) {
  if (!confirm(`${box.name} kasası silinsin mi?`)) return
  await run(async () => {
    await deleteCashbox(box.id)
    success.value = `${box.name} silindi.`
  }, 'Kasa silinemedi.')
}

// --- Ödeme (gider) ---

const emptyExpense = (cashbox: number | null = null): ExpenseForm => ({
  description: '',
  category: 'other',
  payee: '',
  cashbox,
  amount: null,
  paidAt: todayInputValue(),
  receiptNo: '',
  note: '',
})
const expenseForm = reactive<ExpenseForm>(emptyExpense())
const expenseBox = computed(() => boxById(expenseForm.cashbox))
const expenseExceeds = computed(
  () =>
    !!expenseBox.value &&
    expenseForm.amount !== null &&
    expenseForm.amount > expenseBox.value.balance,
)

async function saveExpense() {
  const box = expenseBox.value
  if (!box || expenseForm.amount === null || !expenseForm.description.trim()) return
  await run(async () => {
    await createExpense({
      description: expenseForm.description.trim(),
      category: expenseForm.category,
      payee: expenseForm.payee.trim() || null,
      cashbox: box.id,
      amount: expenseForm.amount!,
      // Gün ortası (UTC) yazılır; saat dilimi farkıyla tarih bir gün kaymaz.
      paidAt: `${expenseForm.paidAt}T12:00:00.000Z`,
      receiptNo: expenseForm.receiptNo.trim() || null,
      note: expenseForm.note.trim() || null,
    })
    success.value = `${expenseForm.description.trim()} için ${box.name} kasasından ${formatMoney(expenseForm.amount, box.currency)} ödendi.`
    Object.assign(expenseForm, emptyExpense(box.id))
  }, 'Ödeme kaydedilemedi.')
}

async function destroyExpense(expense: Expense) {
  const text = `${formatDate(expense.paidAt)} tarihli "${expense.description}" (${formatMoney(expense.amount, expense.currency)}) silinsin mi?`
  if (!confirm(text)) return
  await run(() => deleteExpense(expense.id), 'Silinemedi.')
}

// --- Virman ---

const emptyTransfer = (): TransferForm => ({
  from: null,
  to: null,
  amount: null,
  toAmount: null,
  transferredAt: todayInputValue(),
  note: '',
})
const transferForm = reactive<TransferForm>(emptyTransfer())
const transferFrom = computed(() => boxById(transferForm.from))
const transferTo = computed(() => boxById(transferForm.to))
const crossCurrency = computed(
  () =>
    !!transferFrom.value &&
    !!transferTo.value &&
    transferFrom.value.currency !== transferTo.value.currency,
)
const transferRate = computed(() =>
  crossCurrency.value && transferForm.amount && transferForm.toAmount
    ? roundMoney((transferForm.toAmount / transferForm.amount) * 10000) / 10000
    : null,
)
const transferExceeds = computed(
  () =>
    !!transferFrom.value &&
    transferForm.amount !== null &&
    transferForm.amount > transferFrom.value.balance,
)
const canTransfer = computed(
  () =>
    !!transferFrom.value &&
    !!transferTo.value &&
    transferForm.from !== transferForm.to &&
    !!transferForm.amount &&
    (!crossCurrency.value || !!transferForm.toAmount),
)

async function saveTransfer() {
  const from = transferFrom.value
  const to = transferTo.value
  if (!canTransfer.value || !from || !to) return
  await run(async () => {
    await createTransfer({
      from: from.id,
      to: to.id,
      amount: transferForm.amount!,
      toAmount: crossCurrency.value ? transferForm.toAmount : null,
      transferredAt: `${transferForm.transferredAt}T12:00:00.000Z`,
      note: transferForm.note.trim() || null,
    })
    success.value = `${from.name} → ${to.name}: ${formatMoney(transferForm.amount, from.currency)} aktarıldı.`
    Object.assign(transferForm, emptyTransfer())
  }, 'Virman kaydedilemedi.')
}

async function destroyTransfer(t: CashTransfer) {
  const text = `${formatDate(t.transferredAt)} tarihli ${nameOf(t.from)} → ${nameOf(t.to)} virmanı silinsin mi?`
  if (!confirm(text)) return
  await run(() => deleteTransfer(t.id), 'Silinemedi.')
}

// --- Ortak ---

function nameOf(value: number | Cashbox | null | undefined) {
  if (value && typeof value === 'object') return value.name
  return boxById(value ?? null)?.name ?? '—'
}

function currencyOf(value: number | Cashbox | null | undefined) {
  if (value && typeof value === 'object') return value.currency
  return boxById(value ?? null)?.currency
}

function recorderOf(user: number | User | null | undefined) {
  return user && typeof user === 'object' ? user.email : '—'
}

async function load() {
  loading.value = true
  try {
    const [b, e, t] = await Promise.all([getCashboxBalances(), listExpenses(), listTransfers()])
    balances.value = b
    expenses.value = e
    transfers.value = t
    if (!boxById(expenseForm.cashbox)?.active)
      expenseForm.cashbox = activeBoxes.value[0]?.id ?? null
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Kasa bilgileri yüklenemedi.'
  } finally {
    loading.value = false
  }
}

/** İşlemi çalıştırır, mesajları yönetir ve listeyi tazeler. */
async function run(action: () => Promise<unknown>, failMessage: string) {
  saving.value = true
  error.value = ''
  success.value = ''
  try {
    await action()
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : failMessage
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <section>
    <div class="page-header">
      <h1>Kasa</h1>
      <button class="btn btn-primary" @click="openCashboxForm()">Yeni kasa</button>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
    <div v-if="success" class="alert alert-success" role="status">{{ success }}</div>

    <form v-if="showCashboxForm" class="card form" @submit.prevent="saveCashbox">
      <h2>{{ cashboxForm.id ? 'Kasayı düzenle' : 'Yeni kasa' }}</h2>
      <div class="form-grid">
        <label class="field">
          <span>Kasa adı</span>
          <input v-model="cashboxForm.name" required placeholder="Ör. Merkez nakit USD" />
        </label>
        <label class="field">
          <span>Para birimi</span>
          <select v-model="cashboxForm.currency">
            <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
          </select>
        </label>
        <label class="field">
          <span>Kasa türü</span>
          <select v-model="cashboxForm.kind">
            <option v-for="k in CASHBOX_KIND_OPTIONS" :key="k.value" :value="k.value">
              {{ k.label }}
            </option>
          </select>
        </label>
        <label v-if="!cashboxForm.id" class="field span-all">
          <span>Not</span>
          <input v-model="cashboxForm.note" placeholder="Ör. IBAN, sorumlu kişi" />
        </label>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" @click="showCashboxForm = false">
          Vazgeç
        </button>
        <button
          type="submit"
          class="btn btn-primary"
          :disabled="saving || !cashboxForm.name.trim()"
        >
          {{ saving ? 'Kaydediliyor…' : 'Kaydet' }}
        </button>
      </div>
    </form>

    <p v-if="loading && !balances.length" class="card empty-state">Yükleniyor…</p>
    <p v-else-if="!balances.length" class="card muted notice">
      Henüz kasa yok. Tahsilat ve ödeme girebilmek için önce “Yeni kasa” ile kasa açın (ör. nakit
      USD kasası, TL banka hesabı).
    </p>
    <template v-else>
      <div v-if="totals.length" class="totals">
        <div v-for="t in totals" :key="t.currency" class="card total">
          <span class="muted">Toplam {{ t.currency }} ({{ t.cashboxCount }} kasa)</span>
          <strong :class="{ negative: t.balance < 0 }">{{
            formatMoney(t.balance, t.currency)
          }}</strong>
        </div>
      </div>

      <div class="cash-grid">
        <div v-for="b in balances" :key="b.id" class="card cash" :class="{ passive: !b.active }">
          <div class="cash-head">
            <h2>{{ b.name }}</h2>
            <span class="badge">{{ CASHBOX_KIND_LABELS[b.kind] }}</span>
            <span v-if="!b.active" class="badge badge-warning">Pasif</span>
          </div>
          <p class="balance" :class="{ negative: b.balance < 0 }">
            {{ formatMoney(b.balance, b.currency) }}
          </p>
          <dl class="stats">
            <div>
              <dt>Tahsilat</dt>
              <dd>{{ formatMoney(b.income) }}</dd>
            </div>
            <div>
              <dt>Ödemeler</dt>
              <dd>{{ formatMoney(b.expense) }}</dd>
            </div>
            <div>
              <dt>Virman (giren / çıkan)</dt>
              <dd>{{ formatMoney(b.transferIn) }} / {{ formatMoney(b.transferOut) }}</dd>
            </div>
          </dl>
          <div class="cash-actions">
            <RouterLink class="btn btn-secondary btn-sm" :to="`/kasa/${b.id}`">Döküm</RouterLink>
            <button class="btn btn-secondary btn-sm" @click="openCashboxForm(b)">Düzenle</button>
            <button class="btn btn-secondary btn-sm" :disabled="saving" @click="toggleActive(b)">
              {{ b.active ? 'Pasif yap' : 'Aktif yap' }}
            </button>
            <button class="btn btn-danger btn-sm" :disabled="saving" @click="destroyCashbox(b)">
              Sil
            </button>
          </div>
        </div>
      </div>
    </template>

    <div v-if="activeBoxes.length" class="forms">
      <form class="card form" @submit.prevent="saveExpense">
        <h2>Ödeme gir</h2>
        <div class="form-grid">
          <label class="field span-all">
            <span>Açıklama</span>
            <input
              v-model="expenseForm.description"
              required
              placeholder="Ör. Mekke otel 2. taksit, havalimanı transferi"
            />
          </label>
          <label class="field">
            <span>Kasa</span>
            <select v-model="expenseForm.cashbox" required>
              <option v-for="b in activeBoxes" :key="b.id" :value="b.id">
                {{ b.name }} ({{ b.currency }})
              </option>
            </select>
          </label>
          <label class="field">
            <span>Tutar{{ expenseBox ? ` (${expenseBox.currency})` : '' }}</span>
            <input
              v-model.number="expenseForm.amount"
              type="number"
              min="0.01"
              step="0.01"
              required
            />
          </label>
          <label class="field">
            <span>Kategori</span>
            <select v-model="expenseForm.category">
              <option v-for="c in EXPENSE_CATEGORY_OPTIONS" :key="c.value" :value="c.value">
                {{ c.label }}
              </option>
            </select>
          </label>
          <label class="field">
            <span>Ödenen kişi / firma</span>
            <input v-model="expenseForm.payee" />
          </label>
          <label class="field">
            <span>Ödeme tarihi</span>
            <input v-model="expenseForm.paidAt" type="date" required />
          </label>
          <label class="field">
            <span>Fatura / dekont no</span>
            <input v-model="expenseForm.receiptNo" />
          </label>
          <label class="field span-all">
            <span>Not</span>
            <textarea v-model="expenseForm.note" rows="2" />
          </label>
        </div>
        <p v-if="expenseBox" class="muted small" :class="{ warn: expenseExceeds }">
          {{ expenseBox.name }} kasasında
          {{ formatMoney(expenseBox.balance, expenseBox.currency) }} var.
          <template v-if="expenseExceeds"
            >Bu ödeme kasadaki tutarı aşıyor; kasa eksiye düşecek.</template
          >
        </p>
        <div class="form-actions">
          <button
            type="submit"
            class="btn btn-primary"
            :disabled="
              saving || !expenseBox || !expenseForm.amount || !expenseForm.description.trim()
            "
          >
            {{ saving ? 'Kaydediliyor…' : 'Ödemeyi kaydet' }}
          </button>
        </div>
      </form>

      <form class="card form" @submit.prevent="saveTransfer">
        <h2>Virman (kasalar arası aktarım)</h2>
        <div class="form-grid">
          <label class="field">
            <span>Kaynak kasa</span>
            <select v-model="transferForm.from" required>
              <option v-for="b in activeBoxes" :key="b.id" :value="b.id">
                {{ b.name }} ({{ formatMoney(b.balance, b.currency) }})
              </option>
            </select>
          </label>
          <label class="field">
            <span>Hedef kasa</span>
            <select v-model="transferForm.to" required>
              <option
                v-for="b in activeBoxes"
                :key="b.id"
                :value="b.id"
                :disabled="b.id === transferForm.from"
              >
                {{ b.name }} ({{ b.currency }})
              </option>
            </select>
          </label>
          <label class="field">
            <span>Çıkan tutar{{ transferFrom ? ` (${transferFrom.currency})` : '' }}</span>
            <input
              v-model.number="transferForm.amount"
              type="number"
              min="0.01"
              step="0.01"
              required
            />
          </label>
          <label v-if="crossCurrency" class="field">
            <span>Giren tutar ({{ transferTo?.currency }})</span>
            <input
              v-model.number="transferForm.toAmount"
              type="number"
              min="0.01"
              step="0.01"
              required
            />
          </label>
          <label class="field">
            <span>Tarih</span>
            <input v-model="transferForm.transferredAt" type="date" required />
          </label>
          <label class="field span-all">
            <span>Not</span>
            <input
              v-model="transferForm.note"
              placeholder="Ör. Bankaya yatırıldı, döviz bozduruldu"
            />
          </label>
        </div>
        <p v-if="transferRate" class="muted small">
          Kur: 1 {{ transferFrom?.currency }} = {{ transferRate }} {{ transferTo?.currency }}
        </p>
        <p v-if="transferExceeds" class="small warn">
          {{ transferFrom?.name }} kasasında
          {{ formatMoney(transferFrom?.balance, transferFrom?.currency) }}
          var; virman kasayı eksiye düşürecek.
        </p>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" :disabled="saving || !canTransfer">
            {{ saving ? 'Kaydediliyor…' : 'Virmanı kaydet' }}
          </button>
        </div>
      </form>
    </div>

    <div class="card table-wrap">
      <h2>Yapılan ödemeler</h2>
      <p v-if="!expenses.length" class="empty-state">Henüz ödeme girilmedi.</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Tarih</th>
            <th>Açıklama</th>
            <th>Kategori</th>
            <th>Ödenen</th>
            <th>Kasa</th>
            <th class="num">Tutar</th>
            <th>Dekont no</th>
            <th>Kaydeden</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in expenses" :key="e.id">
            <td>{{ formatDate(e.paidAt) }}</td>
            <td>
              {{ e.description }}
              <small v-if="e.note" class="muted note">{{ e.note }}</small>
            </td>
            <td>{{ EXPENSE_CATEGORY_LABELS[e.category] }}</td>
            <td>{{ e.payee || '—' }}</td>
            <td>{{ nameOf(e.cashbox) }}</td>
            <td class="num">{{ formatMoney(e.amount, e.currency) }}</td>
            <td>{{ e.receiptNo || '—' }}</td>
            <td>{{ recorderOf(e.paidBy) }}</td>
            <td class="actions">
              <button class="btn btn-danger btn-sm" :disabled="saving" @click="destroyExpense(e)">
                Sil
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card table-wrap">
      <h2>Virmanlar</h2>
      <p v-if="!transfers.length" class="empty-state">Henüz virman yapılmadı.</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Tarih</th>
            <th>Kaynak</th>
            <th>Hedef</th>
            <th class="num">Çıkan</th>
            <th class="num">Giren</th>
            <th>Not</th>
            <th>Kaydeden</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in transfers" :key="t.id">
            <td>{{ formatDate(t.transferredAt) }}</td>
            <td>{{ nameOf(t.from) }}</td>
            <td>{{ nameOf(t.to) }}</td>
            <td class="num">{{ formatMoney(t.amount, currencyOf(t.from)) }}</td>
            <td class="num">{{ formatMoney(t.toAmount ?? t.amount, currencyOf(t.to)) }}</td>
            <td>{{ t.note || '—' }}</td>
            <td>{{ recorderOf(t.createdBy) }}</td>
            <td class="actions">
              <button class="btn btn-danger btn-sm" :disabled="saving" @click="destroyTransfer(t)">
                Sil
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.alert,
.card {
  margin-bottom: 1rem;
}

h2 {
  font-size: 1.125rem;
  margin-bottom: 0.75rem;
}

.totals {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1rem;
}

.total {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0;
  padding: 0.75rem 1.25rem;
}

.total strong {
  font-size: 1.25rem;
  font-variant-numeric: tabular-nums;
  color: var(--color-success);
}

.cash-grid,
.forms {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 1rem;
  margin-bottom: 1rem;
}

.cash-grid .card,
.forms .card {
  margin-bottom: 0;
}

.cash.passive {
  opacity: 0.6;
}

.cash-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.cash-head h2 {
  margin: 0;
  margin-right: auto;
}

.balance {
  margin: 0.25rem 0 0.75rem;
  font-size: 1.5rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-success);
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr));
  gap: 1rem;
  margin: 0;
}

.stats dt {
  color: var(--color-muted);
  font-size: 0.8125rem;
}

.stats dd {
  margin: 0.25rem 0 0;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.cash-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 1rem;
}

.negative,
.balance.negative,
.total strong.negative {
  color: var(--color-error);
}

.notice {
  padding: 1rem 1.5rem;
}

.small {
  font-size: 0.875rem;
}

.warn {
  color: var(--color-warning);
  font-weight: 500;
}

.note {
  display: block;
}
</style>
