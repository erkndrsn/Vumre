<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { getAccounts } from '@/api/payments'
import type { AccountBalance, BalanceStatus } from '@/types/payload'
import { formatDate, formatMoney } from '@/utils/accommodation'
import {
  BALANCE_STATUS_BADGE,
  BALANCE_STATUS_LABELS,
  DEFAULT_REMINDER_TEMPLATE,
  OPEN_STATUSES,
  fillReminder,
  whatsappPhone,
} from '@/utils/payments'

type StatusFilter = 'open' | 'all' | BalanceStatus
type KindFilter = 'all' | 'group' | 'person'

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'open', label: 'Ödeme açığı olanlar' },
  { value: 'unpaid', label: BALANCE_STATUS_LABELS.unpaid },
  { value: 'partial', label: BALANCE_STATUS_LABELS.partial },
  { value: 'overpaid', label: BALANCE_STATUS_LABELS.overpaid },
  { value: 'advance', label: BALANCE_STATUS_LABELS.advance },
  { value: 'paid', label: BALANCE_STATUS_LABELS.paid },
  { value: 'unpriced', label: BALANCE_STATUS_LABELS.unpriced },
  { value: 'all', label: 'Tümü' },
]

const TEMPLATE_KEY = 'vumre.reminderTemplate'

const accounts = ref<AccountBalance[]>([])
const loading = ref(false)
const error = ref('')
const copiedKey = ref<string | null>(null)
const expanded = ref<Set<string>>(new Set())
const search = ref('')
const regionFilter = ref<number | ''>('')
const statusFilter = ref<StatusFilter>('open')
const kindFilter = ref<KindFilter>('all')
const showTemplate = ref(false)
const template = ref(readTemplate())

function readTemplate() {
  try {
    return localStorage.getItem(TEMPLATE_KEY) || DEFAULT_REMINDER_TEMPLATE
  } catch {
    return DEFAULT_REMINDER_TEMPLATE
  }
}

watch(template, (value) => {
  try {
    if (value === DEFAULT_REMINDER_TEMPLATE) localStorage.removeItem(TEMPLATE_KEY)
    else localStorage.setItem(TEMPLATE_KEY, value)
  } catch {
    // Tarayıcı depolaması kapalıysa şablon yalnızca bu oturumda geçerli olur.
  }
})

const regions = computed(() => {
  const map = new Map<number, string>()
  for (const a of accounts.value) {
    for (const m of a.members) if (m.region) map.set(m.region.id, m.region.name)
  }
  return [...map]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
})

/**
 * Bölge, tür ve arama filtresi; özet kartları durum filtresinden bağımsız bu listeden
 * hesaplanır. Bir grup, üyelerinden biri bölgeye / aramaya uyuyorsa listelenir.
 */
const scoped = computed(() => {
  const term = search.value.trim().toLocaleLowerCase('tr-TR')
  const hit = (values: (string | null | undefined)[]) =>
    values.some((v) => v?.toLocaleLowerCase('tr-TR').includes(term))
  return accounts.value.filter(
    (a) =>
      (kindFilter.value === 'all' || a.kind === kindFilter.value) &&
      (!regionFilter.value || a.members.some((m) => m.region?.id === regionFilter.value)) &&
      (!term ||
        hit([a.name]) ||
        a.members.some((m) =>
          hit([m.fullName, m.tcNo, m.passportNo, m.phone, m.room?.roomNumber]),
        )),
  )
})

const rows = computed(() => {
  const filter = statusFilter.value
  const list = scoped.value.filter((a) =>
    filter === 'all'
      ? true
      : filter === 'open'
        ? OPEN_STATUSES.includes(a.status)
        : a.status === filter,
  )
  // Açık borçlarda en büyük borç üstte.
  return filter === 'open' || filter === 'unpaid' || filter === 'partial'
    ? [...list].sort((a, b) => b.balance - a.balance)
    : list
})

interface CurrencyTotals {
  currency: string
  price: number
  paid: number
  open: number
  openCount: number
}

const totals = computed<CurrencyTotals[]>(() => {
  const map = new Map<string, CurrencyTotals>()
  for (const a of scoped.value) {
    if (!a.currency) continue
    const t = map.get(a.currency) ?? {
      currency: a.currency,
      price: 0,
      paid: 0,
      open: 0,
      openCount: 0,
    }
    t.price += a.price ?? 0
    t.paid += a.paid
    if (a.balance > 0) {
      t.open += a.balance
      t.openCount++
    }
    map.set(a.currency, t)
  }
  return [...map.values()]
})

const unassignedCount = computed(
  () => scoped.value.filter((a) => a.kind === 'person' && a.status === 'unpriced').length,
)

function toggle(key: string) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

function message(a: AccountBalance) {
  return fillReminder(template.value, {
    name: a.contact?.fullName ?? a.name,
    balance: formatMoney(Math.max(0, a.balance), a.currency),
    paid: formatMoney(a.paid, a.currency),
    price: formatMoney(a.price, a.currency),
    room: a.rooms.join(', '),
    group: a.kind === 'group' ? a.name : '',
    people: String(a.members.length),
  })
}

function whatsappLink(a: AccountBalance) {
  const phone = whatsappPhone(a.contact?.phone)
  return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message(a))}` : null
}

async function copyMessage(a: AccountBalance) {
  try {
    await navigator.clipboard.writeText(message(a))
    copiedKey.value = a.key
    setTimeout(() => {
      if (copiedKey.value === a.key) copiedKey.value = null
    }, 2000)
  } catch {
    error.value = 'Mesaj panoya kopyalanamadı.'
  }
}

function paymentsQuery(a: AccountBalance) {
  return a.kind === 'group' ? { group: String(a.groupId) } : { pilgrim: String(a.members[0]!.id) }
}

function csvCell(value: string | number | null) {
  const text = value === null ? '' : String(value)
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Görünen listeyi Excel'in Türkçe ayarında açılan ; ayraçlı CSV olarak indirir. */
function downloadCsv() {
  const header = [
    'Hesap',
    'Grup',
    'Kişi sayısı',
    'Üyeler',
    'Bölge',
    'İletişim',
    'Telefon',
    'Odalar',
    'Oda ücreti',
    'Ödenen',
    'Kalan',
    'Para birimi',
    'Son ödeme',
    'Durum',
  ]
  const num = (n: number | null) => (n === null ? null : String(n).replace('.', ','))
  const lines = rows.value.map((a) =>
    [
      a.name,
      a.kind === 'group' ? 'Evet' : 'Hayır',
      a.members.length,
      a.kind === 'group' ? a.members.map((m) => m.fullName).join(', ') : null,
      a.regions.join(', ') || null,
      a.contact?.fullName ?? null,
      a.contact?.phone ?? null,
      a.rooms.join(', ') || null,
      num(a.price),
      num(a.paid),
      num(a.balance),
      a.currency,
      a.lastPaymentAt ? formatDate(a.lastPaymentAt) : null,
      BALANCE_STATUS_LABELS[a.status],
    ]
      .map(csvCell)
      .join(';'),
  )
  const blob = new Blob(['﻿' + [header.join(';'), ...lines].join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `odeme-takibi-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function print() {
  window.print()
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    accounts.value = await getAccounts()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Borç bilgileri yüklenemedi.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="debts">
    <div class="page-header">
      <h1>Ödeme Takibi</h1>
      <div class="toolbar no-print">
        <button class="btn btn-secondary" :disabled="!rows.length" @click="downloadCsv">
          CSV indir
        </button>
        <button class="btn btn-secondary" :disabled="!rows.length" @click="print">Yazdır</button>
        <button class="btn btn-secondary" @click="showTemplate = !showTemplate">
          Bilgilendirme mesajı
        </button>
      </div>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

    <div v-if="showTemplate" class="card form no-print">
      <label class="field">
        <span>Bilgilendirme mesajı şablonu</span>
        <textarea v-model="template" rows="3" />
      </label>
      <p class="muted small">
        Kullanılabilir alanlar: <code>{ad}</code> (grupta sorumlu kişi), <code>{kalan}</code>,
        <code>{odenen}</code>, <code>{ucret}</code>, <code>{oda}</code>, <code>{grup}</code>,
        <code>{kisiler}</code> (kişi sayısı). Şablon bu tarayıcıda saklanır.
      </p>
      <div class="form-actions">
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="template === DEFAULT_REMINDER_TEMPLATE"
          @click="template = DEFAULT_REMINDER_TEMPLATE"
        >
          Varsayılana dön
        </button>
      </div>
    </div>

    <div v-if="totals.length" class="totals">
      <div v-for="t in totals" :key="t.currency" class="card total">
        <h2>{{ t.currency }}</h2>
        <dl>
          <div>
            <dt>Toplam borç</dt>
            <dd>{{ formatMoney(t.price, t.currency) }}</dd>
          </div>
          <div>
            <dt>Tahsil edilen</dt>
            <dd>{{ formatMoney(t.paid, t.currency) }}</dd>
          </div>
          <div>
            <dt>Ödeme açığı ({{ t.openCount }} hesap)</dt>
            <dd class="due">{{ formatMoney(t.open, t.currency) }}</dd>
          </div>
        </dl>
      </div>
    </div>
    <p v-if="unassignedCount" class="muted small no-print">
      {{ unassignedCount }} umreci henüz odaya atanmadığı için borcu hesaplanmadı.
    </p>

    <div class="filters no-print">
      <label class="field">
        <select v-model="statusFilter" aria-label="Duruma göre filtrele">
          <option v-for="f in STATUS_FILTERS" :key="f.value" :value="f.value">{{ f.label }}</option>
        </select>
      </label>
      <label class="field">
        <select v-model="kindFilter" aria-label="Hesap türüne göre filtrele">
          <option value="all">Gruplar ve kişiler</option>
          <option value="group">Yalnız ödeme grupları</option>
          <option value="person">Yalnız tek kişiler</option>
        </select>
      </label>
      <label class="field">
        <select v-model="regionFilter" aria-label="Bölgeye göre filtrele">
          <option value="">Tüm bölgeler</option>
          <option v-for="r in regions" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </label>
      <label class="field">
        <input v-model="search" type="search" placeholder="Ad, grup, TC, telefon, oda…" />
      </label>
    </div>

    <div class="card table-wrap">
      <p v-if="loading" class="empty-state">Yükleniyor…</p>
      <p v-else-if="!rows.length" class="empty-state">
        {{ statusFilter === 'open' ? 'Ödeme açığı olan hesap yok.' : 'Kayıt bulunamadı.' }}
      </p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Hesap</th>
            <th>Bölge</th>
            <th>İletişim</th>
            <th>Oda</th>
            <th class="num">Oda ücreti</th>
            <th class="num">Ödenen</th>
            <th class="num">Kalan</th>
            <th>Son ödeme</th>
            <th>Durum</th>
            <th class="no-print" />
          </tr>
        </thead>
        <tbody>
          <template v-for="a in rows" :key="a.key">
            <tr :class="{ 'group-row': a.kind === 'group' }">
              <td>
                <button
                  v-if="a.kind === 'group'"
                  type="button"
                  class="expand"
                  :aria-expanded="expanded.has(a.key)"
                  @click="toggle(a.key)"
                >
                  <span class="caret" aria-hidden="true">{{
                    expanded.has(a.key) ? '▾' : '▸'
                  }}</span>
                  <span>
                    <strong>{{ a.name }}</strong>
                    <small class="muted block">Grup · {{ a.members.length }} kişi</small>
                  </span>
                </button>
                <template v-else>
                  {{ a.name }}
                  <span v-if="a.members[0]?.archived" class="badge badge-warning"
                    >İptal · iade</span
                  >
                </template>
              </td>
              <td>{{ a.regions.join(', ') || '—' }}</td>
              <td class="nowrap">
                <template v-if="a.kind === 'group'">
                  <span v-if="a.hasResponsible && a.contact">{{ a.contact.fullName }}</span>
                  <span v-else class="warn">Sorumlu yok</span>
                  <small v-if="a.contact?.phone" class="muted block">{{ a.contact.phone }}</small>
                </template>
                <template v-else>{{ a.contact?.phone || '—' }}</template>
              </td>
              <td>{{ a.rooms.join(', ') || '—' }}</td>
              <td class="num">{{ formatMoney(a.price, a.currency) }}</td>
              <td class="num">{{ formatMoney(a.paid, a.currency) }}</td>
              <td class="num" :class="{ due: a.balance > 0, over: a.balance < 0 }">
                {{ formatMoney(a.balance, a.currency) }}
              </td>
              <td>{{ a.lastPaymentAt ? formatDate(a.lastPaymentAt) : '—' }}</td>
              <td>
                <span class="badge" :class="BALANCE_STATUS_BADGE[a.status]">
                  {{ BALANCE_STATUS_LABELS[a.status] }}
                </span>
              </td>
              <td class="actions no-print">
                <template v-if="a.balance > 0">
                  <a
                    v-if="whatsappLink(a)"
                    :href="whatsappLink(a)!"
                    target="_blank"
                    rel="noopener"
                    class="btn btn-secondary btn-sm"
                    title="WhatsApp ile bilgilendir"
                    >WhatsApp</a
                  >
                  <button
                    class="btn btn-secondary btn-sm"
                    title="Bilgilendirme mesajını kopyala"
                    @click="copyMessage(a)"
                  >
                    {{ copiedKey === a.key ? 'Kopyalandı' : 'Kopyala' }}
                  </button>
                </template>
                <RouterLink
                  v-if="a.price"
                  :to="{ name: 'payments', query: paymentsQuery(a) }"
                  class="btn btn-primary btn-sm"
                >
                  Tahsilat
                </RouterLink>
              </td>
            </tr>
            <template v-if="a.kind === 'group' && expanded.has(a.key)">
              <tr v-for="m in a.members" :key="`${a.key}:${m.id}`" class="member-row">
                <td class="member-name">
                  {{ m.fullName }}
                  <span v-if="m.archived" class="badge badge-warning">İptal · iade</span>
                </td>
                <td>{{ m.region?.name || '—' }}</td>
                <td class="nowrap">{{ m.phone || '—' }}</td>
                <td>{{ m.room ? m.room.roomNumber : '—' }}</td>
                <td class="num">{{ formatMoney(m.price, m.currency) }}</td>
                <td class="num">{{ m.paid ? formatMoney(m.paid, m.currency) : '—' }}</td>
                <td colspan="4" />
              </tr>
            </template>
          </template>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.toolbar,
.filters {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}

.filters {
  margin-bottom: 1rem;
}

.alert,
.form {
  margin-bottom: 1rem;
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

.totals {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  gap: 1rem;
  margin-bottom: 1rem;
}

.total {
  padding: 1rem 1.25rem;
}

.total h2 {
  font-size: 0.875rem;
  color: var(--color-muted);
  margin-bottom: 0.5rem;
}

.total dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr));
  gap: 0.75rem;
  margin: 0;
}

.total dt {
  color: var(--color-muted);
  font-size: 0.75rem;
}

.total dd {
  margin: 0.125rem 0 0;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.expand {
  display: flex;
  align-items: flex-start;
  gap: 0.375rem;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.caret {
  width: 0.75rem;
  flex-shrink: 0;
}

.member-row td {
  font-size: 0.875rem;
  color: var(--color-muted);
  background: var(--color-hover);
}

.member-name {
  padding-left: 2rem !important;
}

.due {
  color: var(--color-error);
  font-weight: 600;
}

.over {
  color: var(--color-warning);
  font-weight: 600;
}

.table td.num,
.nowrap {
  white-space: nowrap;
}

.actions > * + * {
  margin-left: 0.375rem;
}
</style>

<style>
/* Yazdırırken yalnızca liste ve özet çıkar. */
@media print {
  .topbar,
  .sidebar,
  .no-print {
    display: none !important;
  }

  .debts .card {
    box-shadow: none;
  }
}
</style>
