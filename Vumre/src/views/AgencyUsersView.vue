<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { create, find, remove, update } from '@/api/collections'
import type { User } from '@/types/payload'

interface FormState {
  name: string
  username: string
  email: string
  password: string
}

const items = ref<User[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const success = ref('')
const editingId = ref<number | string | null>(null)
const showForm = ref(false)

const emptyForm = (): FormState => ({ name: '', username: '', email: '', password: '' })
const form = reactive<FormState>(emptyForm())

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await find<User>('users', {
      limit: 0,
      depth: 0,
      sort: 'name',
      where: { role: { equals: 'agency' } },
    })
    items.value = res.docs
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Acente kullanıcıları yüklenemedi.'
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
  })
  editingId.value = item.id
  success.value = ''
  showForm.value = true
}

async function save() {
  saving.value = true
  error.value = ''
  success.value = ''
  const data: Partial<User> & { password?: string } = {
    name: form.name.trim() || null,
    username: form.username.trim().toLowerCase(),
    // E-posta isteğe bağlı; yalnızca şifre sıfırlama bağlantısı için.
    email: form.email.trim() || null,
    role: 'agency',
  }
  // Düzenlemede şifre boş bırakılırsa değişmez.
  if (form.password) data.password = form.password
  try {
    if (editingId.value) {
      await update<User>('users', editingId.value, data)
      success.value = 'Acente kullanıcısı güncellendi.'
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
  if (!confirm(`"${item.name || item.username}" acente kullanıcısı silinsin mi?`)) return
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
      <h1>Acente Kullanıcıları</h1>
      <button class="btn btn-primary" @click="openCreate">Yeni acente kullanıcısı</button>
    </div>

    <p class="muted intro">
      Acente tüm umrecilerin yalnızca adını, soyadını, doğum tarihini, uçuş noktasını, odasını ve
      kimlik resmini görür. Oda yerleşimini ve paneldeki oda/yatak doluluğunu görüntüler; hiçbir
      kaydı değiştiremez. Kasa, tahsilat, ücret, iletişim ve bölge bilgileri ona kapalıdır.
    </p>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>
    <div v-if="success" class="alert alert-success" role="status">{{ success }}</div>

    <form v-if="showForm" class="card form editor" @submit.prevent="save">
      <h2>{{ editingId ? 'Acente kullanıcısını düzenle' : 'Yeni acente kullanıcısı' }}</h2>
      <div class="form-grid">
        <label class="field">
          <span>Ad / Acente adı</span>
          <input v-model="form.name" placeholder="Örnek Turizm" />
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
            placeholder="ornek.turizm"
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
      <p v-else-if="!items.length" class="empty-state">Henüz acente kullanıcısı eklenmedi.</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>Ad</th>
            <th>Kullanıcı adı</th>
            <th>E-posta</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id">
            <td>{{ item.name || '—' }}</td>
            <td>{{ item.username }}</td>
            <td>{{ item.email || '—' }}</td>
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
</style>
