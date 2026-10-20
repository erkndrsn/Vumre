<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { getRoomBoard } from '@/api/accommodation'
import { getCashboxBalances } from '@/api/cashboxes'
import { getAccounts, listPayments } from '@/api/payments'
import { useAuthStore } from '@/stores/auth'
import type { AccountBalance, CashboxBalance, Payment, RoomBoard } from '@/types/payload'
import { formatDate, formatMoney } from '@/utils/accommodation'
import { totalsByCurrency } from '@/utils/cash'
import { ratio, summarizeAccommodation, summarizeMoney } from '@/utils/dashboard'
import { PAYMENT_METHOD_LABELS } from '@/utils/payments'

const auth = useAuthStore()

const board = ref<RoomBoard>({ rooms: [], pilgrims: [] })
const accounts = ref<AccountBalance[]>([])
const recent = ref<Payment[]>([])
const cashboxes = ref<CashboxBalance[]>([])
const loading = ref(false)
const error = ref('')

const isAdmin = computed(() => auth.isAdmin)

/** Bölge yöneticisinin sorumlu olduğu bölgelerdeki umreciler; admin için herkes. */
const ownPilgrims = computed(() => {
  if (isAdmin.value) return board.value.pilgrims
  const ids = new Set(auth.managedRegionIds.map(String))
  return board.value.pilgrims.filter((p) => p.region && ids.has(String(p.region.id)))
})

/** Oda doluluğu her zaman otelin tamamı için; umreci sayıları yöneticide kendi bölgeleri için. */
const stay = computed(() => summarizeAccommodation(board.value.rooms, board.value.pilgrims))
const own = computed(() =>
  isAdmin.value ? stay.value : summarizeAccommodation([], ownPilgrims.value),
)
const money = computed(() => summarizeMoney(accounts.value))
const activeCashboxes = computed(() => cashboxes.value.filter((c) => c.active))
const cashTotals = computed(() => totalsByCurrency(activeCashboxes.value))

const num = new Intl.NumberFormat('tr-TR')
const pct = new Intl.NumberFormat('tr-TR', { style: 'percent', maximumFractionDigits: 0 })
const percent = (value: number, total: number) => pct.format(ratio(value, total))

function cashboxName(p: Payment) {
  return p.cashbox && typeof p.cashbox === 'object'
    ? p.cashbox.name
    : PAYMENT_METHOD_LABELS[p.method]
}

function pilgrimName(p: Payment) {
  return typeof p.pilgrim === 'object' ? p.pilgrim.fullName : `#${p.pilgrim}`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    // Tahsilat, hesap ve kasa verisi yalnızca admine açık; bölge yöneticisi panoyu görür.
    if (!isAdmin.value) {
      board.value = await getRoomBoard()
      return
    }
    const [b, a, r, c] = await Promise.all([
      getRoomBoard(),
      getAccounts(),
      listPayments(undefined, 5),
      getCashboxBalances(),
    ])
    board.value = b
    accounts.value = a
    recent.value = r
    cashboxes.value = c
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Özet bilgileri yüklenemedi.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="dashboard">
    <div class="page-header">
      <div>
        <h1>Panel</h1>
        <p class="muted">{{ auth.user?.email }} olarak giriş yaptınız.</p>
      </div>
      <button class="btn btn-secondary" :disabled="loading" @click="load">
        {{ loading ? 'Yükleniyor…' : 'Yenile' }}
      </button>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

    <div class="tiles">
      <!-- Bölge yöneticisi tüm bölgelerin toplamını da, kendi bölgelerininkini de görür. -->
      <RouterLink
        v-if="!isAdmin"
        :to="{ name: 'pilgrims-by-region', query: { region: 'all' } }"
        class="card tile tile-link"
      >
        <span class="muted">Toplam umreci</span>
        <strong class="value">{{ num.format(stay.pilgrims) }}</strong>
        <span class="muted small">
          {{ num.format(stay.male) }} erkek · {{ num.format(stay.female) }} kadın
          <template v-if="stay.children"> · {{ num.format(stay.children) }} çocuk</template>
          <template v-if="stay.infants"> (+ {{ num.format(stay.infants) }} bebek)</template>
        </span>
      </RouterLink>

      <RouterLink
        :to="{ name: isAdmin ? 'pilgrims' : 'pilgrims-by-region' }"
        class="card tile tile-link"
      >
        <span class="muted">{{ isAdmin ? 'Toplam umreci' : 'Bölgelerimdeki umreci' }}</span>
        <strong class="value">{{ num.format(own.pilgrims) }}</strong>
        <span class="muted small">
          {{ num.format(own.male) }} erkek · {{ num.format(own.female) }} kadın
          <template v-if="own.children"> · {{ num.format(own.children) }} çocuk</template>
          <template v-if="own.infants"> (+ {{ num.format(own.infants) }} bebek)</template>
        </span>
      </RouterLink>

      <RouterLink :to="{ name: 'room-board' }" class="card tile tile-link">
        <span class="muted">Odası atanmamış</span>
        <strong class="value" :class="{ warn: own.unassigned }">
          {{ num.format(own.unassigned) }}
        </strong>
        <span class="muted small">{{ num.format(own.assigned) }} umreci odaya yerleşti</span>
      </RouterLink>

      <RouterLink :to="{ name: isAdmin ? 'rooms' : 'room-board' }" class="card tile tile-link">
        <span class="muted">Dolu oda</span>
        <strong class="value">
          {{ num.format(stay.full) }}<small class="muted"> / {{ num.format(stay.rooms) }}</small>
        </strong>
        <span class="muted small">
          {{ num.format(stay.partial) }} kısmen dolu · {{ num.format(stay.empty) }} boş
        </span>
      </RouterLink>

      <div class="card tile">
        <span class="muted">Yatak doluluğu</span>
        <strong class="value">{{ percent(stay.occupiedBeds, stay.beds) }}</strong>
        <span class="track" aria-hidden="true">
          <span class="fill" :style="{ width: percent(stay.occupiedBeds, stay.beds) }" />
        </span>
        <span class="muted small">
          {{ num.format(stay.occupiedBeds) }} / {{ num.format(stay.beds) }} yatak ·
          {{ num.format(stay.beds - stay.occupiedBeds) }} boş
        </span>
      </div>
    </div>

    <template v-if="isAdmin">
      <h2 class="section-title">Mali durum</h2>
      <div v-if="money.length" class="money">
        <div v-for="m in money" :key="m.currency" class="card money-card">
          <div class="money-head">
            <h3>{{ m.currency }}</h3>
            <span class="muted small">Tahsilat oranı {{ percent(m.paid, m.total) }}</span>
          </div>
          <span class="track" aria-hidden="true">
            <span class="fill fill-success" :style="{ width: percent(m.paid, m.total) }" />
          </span>
          <dl>
            <div>
              <dt>Toplam tutar</dt>
              <dd>{{ formatMoney(m.total, m.currency) }}</dd>
            </div>
            <div>
              <dt>Toplam tahsilat</dt>
              <dd class="ok">{{ formatMoney(m.paid, m.currency) }}</dd>
            </div>
            <div>
              <dt>Kalan alacak ({{ num.format(m.openAccounts) }} hesap)</dt>
              <dd :class="{ due: m.open > 0 }">{{ formatMoney(m.open, m.currency) }}</dd>
            </div>
            <div v-if="m.overpaid">
              <dt>Fazla ödeme</dt>
              <dd class="warn">{{ formatMoney(m.overpaid, m.currency) }}</dd>
            </div>
            <div v-if="m.advance">
              <dt>Ön ödeme (oda bekleyen)</dt>
              <dd class="ok">{{ formatMoney(m.advance, m.currency) }}</dd>
            </div>
          </dl>
        </div>
      </div>
      <p v-else-if="!loading" class="card empty-state">
        Odaya atanmış umreci olmadığı için tutar yok.
      </p>
    </template>

    <div class="panels">
      <div v-if="isAdmin" class="card panel table-wrap">
        <div class="panel-head">
          <h2>Kasalar</h2>
          <RouterLink :to="{ name: 'cash' }" class="link-small">Kasa</RouterLink>
        </div>
        <p v-if="!activeCashboxes.length" class="empty-state">Henüz kasa açılmadı.</p>
        <table v-else class="table">
          <tbody>
            <tr v-for="c in activeCashboxes" :key="c.id">
              <td>
                <RouterLink :to="{ name: 'cashbox-ledger', params: { id: c.id } }">
                  {{ c.name }}
                </RouterLink>
              </td>
              <td class="num" :class="{ due: c.balance < 0 }">
                {{ formatMoney(c.balance, c.currency) }}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr v-for="t in cashTotals" :key="t.currency">
              <th>Toplam {{ t.currency }}</th>
              <th class="num">{{ formatMoney(t.balance, t.currency) }}</th>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="card panel table-wrap">
        <div class="panel-head">
          <h2>Oda tiplerine göre doluluk</h2>
          <RouterLink :to="{ name: isAdmin ? 'room-types' : 'room-board' }" class="link-small">{{
            isAdmin ? 'Oda tipleri' : 'Oda yerleşimi'
          }}</RouterLink>
        </div>
        <p v-if="!stay.byType.length" class="empty-state">Henüz aktif oda yok.</p>
        <table v-else class="table">
          <thead>
            <tr>
              <th>Oda tipi</th>
              <th class="num">Oda</th>
              <th class="num">Dolu</th>
              <th class="num">Kısmen</th>
              <th class="num">Boş</th>
              <th class="num">Yatak</th>
              <th class="num">Doluluk</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in stay.byType" :key="t.key">
              <td>{{ t.name }}</td>
              <td class="num">{{ num.format(t.rooms) }}</td>
              <td class="num">{{ num.format(t.full) }}</td>
              <td class="num">{{ num.format(t.partial) }}</td>
              <td class="num">{{ num.format(t.empty) }}</td>
              <td class="num">{{ num.format(t.occupiedBeds) }} / {{ num.format(t.beds) }}</td>
              <td class="num">{{ percent(t.occupiedBeds, t.beds) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <th>Toplam</th>
              <th class="num">{{ num.format(stay.rooms) }}</th>
              <th class="num">{{ num.format(stay.full) }}</th>
              <th class="num">{{ num.format(stay.partial) }}</th>
              <th class="num">{{ num.format(stay.empty) }}</th>
              <th class="num">{{ num.format(stay.occupiedBeds) }} / {{ num.format(stay.beds) }}</th>
              <th class="num">{{ percent(stay.occupiedBeds, stay.beds) }}</th>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="card panel">
        <div class="panel-head">
          <h2>{{ isAdmin ? 'Bölgelere göre umreciler' : 'Bölgelerim' }}</h2>
          <RouterLink
            :to="{ name: isAdmin ? 'regions' : 'pilgrims-by-region' }"
            class="link-small"
            >{{ isAdmin ? 'Bölgeler' : 'Bölge listesi' }}</RouterLink
          >
        </div>
        <p v-if="!own.byRegion.length" class="empty-state">Henüz umreci kaydı yok.</p>
        <ul v-else class="bars">
          <li v-for="r in own.byRegion" :key="r.name">
            <div class="bar-head">
              <span>{{ r.name }}</span>
              <strong>{{ num.format(r.count) }}</strong>
            </div>
            <span class="track" aria-hidden="true">
              <span class="fill" :style="{ width: percent(r.count, own.pilgrims) }" />
            </span>
          </li>
        </ul>
      </div>

      <div v-if="isAdmin" class="card panel table-wrap">
        <div class="panel-head">
          <h2>Son tahsilatlar</h2>
          <RouterLink :to="{ name: 'payments' }" class="link-small">Tümü</RouterLink>
        </div>
        <p v-if="!recent.length" class="empty-state">Henüz tahsilat yok.</p>
        <table v-else class="table">
          <tbody>
            <tr v-for="p in recent" :key="p.id">
              <td>
                {{ pilgrimName(p) }}
                <small class="muted block">{{ cashboxName(p) }}</small>
              </td>
              <td class="nowrap">{{ formatDate(p.paidAt) }}</td>
              <td class="num">{{ formatMoney(p.amount, p.currency) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page-header p {
  margin-top: 0.25rem;
}

.alert {
  margin-bottom: 1rem;
}

.small {
  font-size: 0.875rem;
}

.block {
  display: block;
}

.nowrap {
  white-space: nowrap;
}

.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
}

.tile {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 1rem 1.25rem;
  color: inherit;
  text-decoration: none;
}

.tile-link:hover {
  border-color: var(--color-primary);
}

.value {
  font-size: 1.75rem;
  line-height: 1.2;
  color: var(--color-heading);
  font-variant-numeric: tabular-nums;
}

.value small {
  font-size: 1rem;
  font-weight: 400;
}

.track {
  display: block;
  height: 0.375rem;
  border-radius: 999px;
  background: var(--color-hover);
  overflow: hidden;
}

.fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-primary);
}

.fill-success {
  background: var(--color-success);
}

.section-title {
  font-size: 1.125rem;
  margin: 1.75rem 0 0.75rem;
}

.money {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
  gap: 1rem;
}

.money-card {
  padding: 1rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.money-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
}

.money-head h3 {
  font-size: 1rem;
}

.money-card dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.75rem;
  margin: 0;
}

.money-card dt {
  color: var(--color-muted);
  font-size: 0.75rem;
}

.money-card dd {
  margin: 0.125rem 0 0;
  font-weight: 600;
  font-size: 1.0625rem;
  font-variant-numeric: tabular-nums;
}

.ok {
  color: var(--color-success);
}

.due {
  color: var(--color-error);
}

.warn {
  color: var(--color-warning);
}

.panels {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: 1rem;
  margin-top: 1.75rem;
}

.panel {
  padding: 1rem 1.25rem;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.panel-head h2 {
  font-size: 1rem;
}

.panel .table th,
.panel .table td {
  padding: 0.5rem 0.375rem;
}

.panel .table tfoot th {
  color: var(--color-text);
  border-bottom: 0;
}

.bars {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.bar-head {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
  font-size: 0.9375rem;
}
</style>
