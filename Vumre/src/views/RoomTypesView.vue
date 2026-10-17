<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { create, find, remove, update } from '@/api/collections'
import type { ChildPrice, Currency, OtherPrice, RoomType } from '@/types/payload'
import { CURRENCIES, formatMoney } from '@/utils/accommodation'
import { agePriceError, otherPriceError, sortedAgePrices } from '@/utils/childPricing'

interface ChildPriceRow {
  minAge: number | null
  maxAge: number | null
  price: number | null
}

interface OtherPriceRow {
  currency: Currency | ''
  pricePerPerson: number | null
}

interface FormState {
  name: string
  capacity: number | null
  pricePerPerson: number | null
  childPrices: ChildPriceRow[]
  currency: Currency
  otherPrices: OtherPriceRow[]
  description: string
  active: boolean
}

const items = ref<RoomType[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const editingId = ref<number | null>(null)
const showForm = ref(false)

const emptyForm = (): FormState => ({
  name: '',
  capacity: null,
  pricePerPerson: null,
  childPrices: [],
  currency: 'USD',
  otherPrices: [],
  description: '',
  active: true,
})
const form = reactive<FormState>(emptyForm())

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await find<RoomType>('room-types', { limit: 0, sort: 'capacity' })
    items.value = res.docs
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Oda tipleri yüklenemedi.'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  Object.assign(form, emptyForm())
  editingId.value = null
  showForm.value = true
}

function openEdit(item: RoomType) {
  Object.assign(form, {
    name: item.name,
    capacity: item.capacity,
    pricePerPerson: item.pricePerPerson,
    childPrices: sortedAgePrices(item.childPrices).map(({ minAge, maxAge, price }) => ({
      minAge,
      maxAge,
      price,
    })),
    currency: item.currency,
    otherPrices: (item.otherPrices ?? []).map(({ currency, pricePerPerson }) => ({
      currency,
      pricePerPerson,
    })),
    description: item.description ?? '',
    active: item.active !== false,
  })
  editingId.value = item.id
  showForm.value = true
}

function addChildPrice() {
  const last = form.childPrices[form.childPrices.length - 1]
  const start = last?.maxAge != null ? last.maxAge + 1 : 0
  form.childPrices.push({ minAge: start, maxAge: null, price: null })
}

/** Satırlarda henüz seçilmemiş, ana para birimi olmayan para birimleri. */
const freeCurrencies = computed(() =>
  CURRENCIES.filter((c) => c !== form.currency && !form.otherPrices.some((o) => o.currency === c)),
)

function addOtherPrice() {
  form.otherPrices.push({ currency: freeCurrencies.value[0] ?? '', pricePerPerson: null })
}

/** Satırın seçebileceği para birimleri: kendi seçimi ve boşta olanlar. */
function currencyChoices(row: OtherPriceRow) {
  return CURRENCIES.filter((c) => c === row.currency || freeCurrencies.value.includes(c))
}

async function save() {
  const rangeError =
    agePriceError(form.childPrices.map(toAgePrice)) ??
    otherPriceError(form.otherPrices.map(toOtherPrice), form.currency)
  if (rangeError) {
    error.value = rangeError
    return
  }
  saving.value = true
  error.value = ''
  try {
    const data = {
      ...form,
      capacity: form.capacity ?? undefined,
      pricePerPerson: form.pricePerPerson ?? undefined,
      // agePriceError yukarıda boş hücre bırakmadığını doğruladı.
      childPrices: form.childPrices.map(toAgePrice) as ChildPrice[],
      otherPrices: form.otherPrices.map(toOtherPrice) as OtherPrice[],
    }
    if (editingId.value) await update<RoomType>('room-types', editingId.value, data)
    else await create<RoomType>('room-types', data)
    showForm.value = false
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Kaydedilemedi.'
  } finally {
    saving.value = false
  }
}

// Boş bırakılan hücre `""` gelebilir; doğrulama "zorunlu" hatası versin diye undefined'a indir.
function toAgePrice(row: ChildPriceRow) {
  const num = (v: number | null) => (typeof v === 'number' ? v : undefined)
  return { minAge: num(row.minAge), maxAge: num(row.maxAge), price: num(row.price) }
}

function toOtherPrice(row: OtherPriceRow) {
  return {
    currency: row.currency || undefined,
    pricePerPerson: typeof row.pricePerPerson === 'number' ? row.pricePerPerson : undefined,
  }
}

function childPriceSummary(item: RoomType) {
  return sortedAgePrices(item.childPrices).map(
    (r) => `${r.minAge}-${r.maxAge} yaş: ${formatMoney(r.price, item.currency)}`,
  )
}

async function destroy(item: RoomType) {
  if (!confirm(`"${item.name}" oda tipi silinsin mi?`)) return
  error.value = ''
  try {
    await remove('room-types', item.id)
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Silinemedi.'
  }
}

onMounted(load)
</script>

<template>
  <section>
    <div class="page-header">
      <h1>Oda Tipleri</h1>
      <button class="btn btn-primary" @click="openCreate">Yeni oda tipi</button>
    </div>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

    <form v-if="showForm" class="card form editor" @submit.prevent="save">
      <h2>{{ editingId ? 'Oda tipini düzenle' : 'Yeni oda tipi' }}</h2>
      <div class="form-grid">
        <label class="field">
          <span>Oda tipi adı</span>
          <input v-model.trim="form.name" required placeholder="3 Kişilik Standart" />
        </label>
        <label class="field">
          <span>Kişi kapasitesi</span>
          <input v-model.number="form.capacity" type="number" min="1" required />
        </label>
        <label class="field">
          <span>Kişi başı ücret (yetişkin)</span>
          <input v-model.number="form.pricePerPerson" type="number" min="0" step="0.01" required />
        </label>
        <label class="field">
          <span>Para birimi</span>
          <select v-model="form.currency">
            <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
          </select>
        </label>
        <fieldset class="field span-all child-prices">
          <legend>Çocuk ücretleri (yaş aralığına göre)</legend>
          <p class="muted hint">
            Yaşlar tamamlanmış yaştır, iki uç dahildir (ör. 2-6 → 2 ile 6 yaş arası). Bu aralıklara
            girmeyen herkese kişi başı ücret uygulanır.
          </p>
          <div v-for="(row, i) in form.childPrices" :key="i" class="child-row">
            <label class="field">
              <span>Başlangıç yaşı</span>
              <input v-model.number="row.minAge" type="number" min="0" step="1" required />
            </label>
            <label class="field">
              <span>Bitiş yaşı</span>
              <input v-model.number="row.maxAge" type="number" min="0" step="1" required />
            </label>
            <label class="field">
              <span>Kişi başı ücret ({{ form.currency }})</span>
              <input v-model.number="row.price" type="number" min="0" step="0.01" required />
            </label>
            <button
              type="button"
              class="btn btn-danger btn-sm"
              @click="form.childPrices.splice(i, 1)"
            >
              Kaldır
            </button>
          </div>
          <div>
            <button type="button" class="btn btn-secondary btn-sm" @click="addChildPrice">
              Yaş aralığı ekle
            </button>
          </div>
        </fieldset>
        <fieldset class="field span-all child-prices">
          <legend>Diğer para birimlerinde ücret</legend>
          <p class="muted hint">
            Ödeme bu para birimlerinde de alınabilir. Borç {{ form.currency }} olarak tutulur;
            örneğin 1000 {{ form.currency }} = 920 EUR girilirse 460 EUR'luk ödeme borçtan 500
            {{ form.currency }} düşer. Çocuk ücretlerine de aynı oran uygulanır.
          </p>
          <div v-for="(row, i) in form.otherPrices" :key="i" class="other-row">
            <label class="field">
              <span>Para birimi</span>
              <select v-model="row.currency" required>
                <option v-for="c in currencyChoices(row)" :key="c" :value="c">{{ c }}</option>
              </select>
            </label>
            <label class="field">
              <span>Kişi başı ücret (yetişkin)</span>
              <input
                v-model.number="row.pricePerPerson"
                type="number"
                min="0"
                step="0.01"
                required
              />
            </label>
            <button
              type="button"
              class="btn btn-danger btn-sm"
              @click="form.otherPrices.splice(i, 1)"
            >
              Kaldır
            </button>
          </div>
          <div>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              :disabled="!freeCurrencies.length"
              @click="addOtherPrice"
            >
              Para birimi ekle
            </button>
          </div>
        </fieldset>
        <label class="field span-all">
          <span>Açıklama</span>
          <textarea v-model="form.description" rows="2" />
        </label>
        <label class="field field-check">
          <input v-model="form.active" type="checkbox" />
          <span>Aktif</span>
        </label>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" @click="showForm = false">Vazgeç</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Kaydediliyor…' : 'Kaydet' }}
        </button>
      </div>
    </form>

    <div class="card table-wrap">
      <p v-if="loading" class="empty-state">Yükleniyor…</p>
      <p v-else-if="!items.length" class="empty-state">Henüz oda tipi tanımlanmadı.</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Oda tipi</th>
            <th class="num">Kapasite</th>
            <th class="num">Kişi başı ücret</th>
            <th>Çocuk ücretleri</th>
            <th>Açıklama</th>
            <th>Durum</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in items"
            :key="item.id"
            :class="{ 'is-disabled': item.active === false }"
          >
            <td>{{ item.name }}</td>
            <td class="num">{{ item.capacity }} kişi</td>
            <td class="num">
              {{ formatMoney(item.pricePerPerson, item.currency) }}
              <ul v-if="item.otherPrices?.length" class="child-summary muted">
                <li v-for="o in item.otherPrices" :key="o.currency">
                  {{ formatMoney(o.pricePerPerson, o.currency) }}
                </li>
              </ul>
            </td>
            <td>
              <ul v-if="item.childPrices?.length" class="child-summary">
                <li v-for="line in childPriceSummary(item)" :key="line">{{ line }}</li>
              </ul>
              <span v-else class="muted">—</span>
            </td>
            <td>{{ item.description || '—' }}</td>
            <td>
              <span class="badge" :class="{ 'badge-success': item.active !== false }">
                {{ item.active === false ? 'Pasif' : 'Aktif' }}
              </span>
            </td>
            <td class="actions">
              <button class="btn btn-secondary btn-sm" @click="openEdit(item)">Düzenle</button>
              <button class="btn btn-danger btn-sm" @click="destroy(item)">Sil</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.alert,
.editor {
  margin-bottom: 1rem;
}

.editor h2 {
  font-size: 1.125rem;
}

.child-prices {
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 0.75rem;
  display: grid;
  gap: 0.5rem;
}

.child-prices .hint {
  margin: 0;
  font-size: 0.875rem;
}

.child-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
  gap: 0.5rem;
  align-items: end;
}

.other-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)) auto;
  gap: 0.5rem;
  align-items: end;
}

.child-summary {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.875rem;
}

@media (max-width: 640px) {
  .child-row {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
