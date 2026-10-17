<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { getCashboxLedger } from '@/api/cashboxes'
import type { CashboxBalance, CashboxLedger } from '@/types/payload'
import { formatDate, formatMoney } from '@/utils/accommodation'
import { CASHBOX_KIND_LABELS, LEDGER_TYPE_LABELS } from '@/utils/cash'

const route = useRoute()
const cashbox = ref<CashboxBalance | null>(null)
const ledger = ref<CashboxLedger | null>(null)
const loading = ref(false)
const error = ref('')
const from = ref('')
const to = ref('')

const id = computed(() => Number(route.params.id))
const filtered = computed(() => !!from.value || !!to.value)

async function load() {
  if (!Number.isFinite(id.value)) return
  loading.value = true
  error.value = ''
  try {
    const res = await getCashboxLedger(id.value, { from: from.value, to: to.value })
    cashbox.value = res.cashbox
    ledger.value = res.ledger
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Kasa dökümü yüklenemedi.'
  } finally {
    loading.value = false
  }
}

function clearRange() {
  from.value = ''
  to.value = ''
}

watch([id, from, to], load, { immediate: true })
</script>

<template>
  <section>
    <div class="page-header">
      <h1>{{ cashbox ? `${cashbox.name} dökümü` : 'Kasa dökümü' }}</h1>
      <RouterLink class="btn btn-secondary" to="/kasa">Kasalara dön</RouterLink>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

    <div v-if="cashbox" class="card summary">
      <div>
        <span class="badge">{{ CASHBOX_KIND_LABELS[cashbox.kind] }}</span>
        <span v-if="!cashbox.active" class="badge badge-warning">Pasif</span>
      </div>
      <div class="stat">
        <span class="muted">Güncel bakiye</span>
        <strong :class="{ negative: cashbox.balance < 0 }">
          {{ formatMoney(cashbox.balance, cashbox.currency) }}
        </strong>
      </div>
      <form class="range" @submit.prevent>
        <label class="field">
          <span>Başlangıç</span>
          <input v-model="from" type="date" />
        </label>
        <label class="field">
          <span>Bitiş</span>
          <input v-model="to" type="date" />
        </label>
        <button v-if="filtered" type="button" class="btn btn-secondary btn-sm" @click="clearRange">
          Tüm hareketler
        </button>
      </form>
    </div>

    <div class="card table-wrap">
      <p v-if="loading && !ledger" class="empty-state">Yükleniyor…</p>
      <p v-else-if="ledger && !ledger.entries.length && !ledger.opening" class="empty-state">
        {{ filtered ? 'Bu tarih aralığında hareket yok.' : 'Bu kasada henüz hareket yok.' }}
      </p>
      <table v-else-if="ledger && cashbox" class="table">
        <thead>
          <tr>
            <th>Tarih</th>
            <th>Tür</th>
            <th>Açıklama</th>
            <th class="num">Giren</th>
            <th class="num">Çıkan</th>
            <th class="num">Bakiye</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="from" class="carry">
            <td>{{ formatDate(`${from}T12:00:00.000Z`) }}</td>
            <td colspan="4">Devreden bakiye</td>
            <td class="num" :class="{ negative: ledger.opening < 0 }">
              {{ formatMoney(ledger.opening) }}
            </td>
          </tr>
          <tr v-for="e in ledger.entries" :key="`${e.type}-${e.id}`">
            <td>{{ formatDate(e.date) }}</td>
            <td>
              <span class="badge" :class="e.in ? 'badge-success' : 'badge-error'">
                {{ LEDGER_TYPE_LABELS[e.type] }}
              </span>
            </td>
            <td>{{ e.description || '—' }}</td>
            <td class="num">{{ e.in ? formatMoney(e.in) : '' }}</td>
            <td class="num">{{ e.out ? formatMoney(e.out) : '' }}</td>
            <td class="num" :class="{ negative: e.balance < 0 }">{{ formatMoney(e.balance) }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th colspan="3">Toplam ({{ cashbox.currency }})</th>
            <th class="num">{{ formatMoney(ledger.totalIn) }}</th>
            <th class="num">{{ formatMoney(ledger.totalOut) }}</th>
            <th class="num" :class="{ negative: ledger.closing < 0 }">
              {{ formatMoney(ledger.closing) }}
            </th>
          </tr>
        </tfoot>
      </table>
    </div>
  </section>
</template>

<style scoped>
.alert,
.card {
  margin-bottom: 1rem;
}

.summary {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 1.5rem;
}

.summary .badge + .badge {
  margin-left: 0.5rem;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.stat strong {
  font-size: 1.5rem;
  font-variant-numeric: tabular-nums;
  color: var(--color-success);
}

.range {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem;
  margin-left: auto;
}

.carry td {
  font-style: italic;
  color: var(--color-muted);
}

.negative,
.stat strong.negative {
  color: var(--color-error);
}
</style>
