<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { create, find, remove, update } from '@/api/collections'
import type { Region, User } from '@/types/payload'

interface FormState {
  name: string
  username: string
  email: string
  password: string
  regions: number[]
}

const items = ref<User[]>([])
const regions = ref<Region[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const success = ref('')
const editingId = ref<number | string | null>(null)
const showForm = ref(false)

const emptyForm = (): FormState => ({
  name: '',
  username: '',
  email: '',
  password: '',
  regions: [],
})
const form = reactive<FormState>(emptyForm())

const regionIds = (user: User) =>
  (user.regions ?? []).map((r) => (typeof r === 'object' ? r.id : r))

const regionNames = (user: User) => {
  const names = regionIds(user).map((id) => regions.value.find((r) => r.id === id)?.name ?? '?')
  return names.length ? names.join(', ') : '—'
}

// Pasif bölgeler yeni seçime kapalı; yöneticinin mevcut bölgesi pasif olsa da listede kalır.
const regionOptions = computed(() =>
  regions.value.filter((r) => r.active !== false || form.regions.includes(r.id)),
)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [users, regionRes] = await Promise.all([
      find<User>('users', {
        limit: 0,
        depth: 0,
        sort: 'name',
        where: { role: { equals: 'regionManager' } },
      }),
      find<Region>('regions', { limit: 0, sort: 'name' }),
    ])
    items.value = users.docs
    regions.value = regionRes.docs
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Bölge yöneticileri yüklenemedi.'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  Object.assign(form, emptyForm())
  editingId.value = null
  success.value = ''
  showForm.value = true
}

function openEdit(item: User) {
  Object.assign(form, {
    name: item.name ?? '',
    username: item.username,
    email: item.email ?? '',
    password: '',
    regions: regionIds(item),
  })
  editingId.value = item.id
  success.value = ''
  showForm.value = true
}

async function save() {
  if (!form.regions.length) {
    error.value = 'En az bir bölge seçin.'
    return
  }
  saving.value = true
  error.value = ''
  success.value = ''
  const data: Partial<User> & { password?: string } = {
    name: form.name.trim() || null,
    username: form.username.trim().toLowerCase(),
    // E-posta isteğe bağlı; yalnızca şifre sıfırlama bağlantısı için.
    email: form.email.trim() || null,
    role: 'regionManager',
    regions: form.regions,
  }
  // Düzenlemede şifre boş bırakılırsa değişmez.
  if (form.password) data.password = form.password
  try {
    if (editingId.value) {
      await update<User>('users', editingId.value, data)
      success.value = 'Bölge yöneticisi güncellendi.'
    } else {
      await create<User>('users', data)
      success.value = `${data.username} eklendi. Bu kullanıcı adı ve şifreyle giriş yapabilir.`
    }
    showForm.value = false
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Kaydedilemedi.'
  } finally {
    saving.value = false
  }
}

async function destroy(item: User) {
  if (!confirm(`"${item.name || item.username}" bölge yöneticisi silinsin mi?`)) return
  error.value = ''
  success.value = ''
  try {
    await remove('users', item.id)
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
      <h1>Bölge Yöneticileri</h1>
      <button class="btn btn-primary" @click="openCreate">Yeni bölge yöneticisi</button>
    </div>

    <p class="muted intro">
      Bölge yöneticisi yalnızca sorumlu olduğu bölgelerdeki umrecileri görür ve kişi bilgilerini
      (iletişim, kimlik, uçuş noktası, adres…) güncelleyebilir. Oda ataması, ödemeler ve diğer
      ekranlar ona kapalıdır.
    </p>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
    <div v-if="success" class="alert alert-success" role="status">{{ success }}</div>

    <form v-if="showForm" class="card form editor" @submit.prevent="save">
      <h2>{{ editingId ? 'Bölge yöneticisini düzenle' : 'Yeni bölge yöneticisi' }}</h2>
      <div class="form-grid">
        <label class="field">
          <span>Ad Soyad</span>
          <input v-model="form.name" placeholder="Ahmet Yılmaz" />
        </label>
        <label class="field">
          <span>Kullanıcı adı</span>
          <input
            v-model="form.username"
            required
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            pattern="[A-Za-z0-9._\-]+"
            title="Harf, rakam, nokta, alt çizgi ve tire kullanılabilir."
            placeholder="ahmet.yilmaz"
          />
        </label>
        <label class="field">
          <span>E-posta (isteğe bağlı)</span>
          <input v-model="form.email" type="email" autocomplete="off" />
          <small class="muted">Yalnızca şifremi unuttum bağlantısı için kullanılır.</small>
        </label>
        <label class="field">
          <span>{{ editingId ? 'Yeni şifre' : 'Şifre' }}</span>
          <input
            v-model="form.password"
            type="password"
            :required="!editingId"
            minlength="6"
            autocomplete="new-password"
            :placeholder="editingId ? 'Değiştirmek için doldurun' : ''"
          />
        </label>
        <fieldset class="field span-all regions">
          <legend>Sorumlu olduğu bölgeler</legend>
          <p v-if="!regionOptions.length" class="muted">
            Henüz bölge yok. <RouterLink :to="{ name: 'regions' }">Bölge ekle</RouterLink>
          </p>
          <label v-for="r in regionOptions" :key="r.id" class="field-check">
            <input v-model="form.regions" type="checkbox" :value="r.id" />
            <span>{{ r.name }}{{ r.active === false ? ' (pasif)' : '' }}</span>
          </label>
        </fieldset>
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
      <p v-else-if="!items.length" class="empty-state">Henüz bölge yöneticisi eklenmedi.</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Ad Soyad</th>
            <th>Kullanıcı adı</th>
            <th>E-posta</th>
            <th>Bölgeler</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id">
            <td>{{ item.name || '—' }}</td>
            <td>{{ item.username }}</td>
            <td>{{ item.email || '—' }}</td>
            <td>{{ regionNames(item) }}</td>
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
.editor,
.intro {
  margin-bottom: 1rem;
}

.editor h2 {
  font-size: 1.125rem;
}

.regions {
  border: 0;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.25rem;
}

.regions legend {
  margin-bottom: 0.5rem;
}
</style>
