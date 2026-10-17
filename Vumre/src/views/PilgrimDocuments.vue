<script setup lang="ts">
// Umreci detayındaki kimlik resmi ve doküman bölümü (PilgrimFormView içinde kullanılır).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { listDocuments, removeDocument, uploadDocument } from '@/api/pilgrimDocuments'
import type { PilgrimDocument, PilgrimDocumentKind } from '@/types/payload'
import ImageCropDialog from './ImageCropDialog.vue'

const props = defineProps<{ pilgrimId: number }>()

const documents = ref<PilgrimDocument[]>([])
const loading = ref(false)
const uploading = ref<PilgrimDocumentKind | null>(null)
const error = ref('')
const note = ref('')
const preview = ref<PilgrimDocument | null>(null)
/** Kırpma/döndürme penceresinde açık kimlik görseli. */
const editing = ref<File | null>(null)

const idInput = ref<HTMLInputElement | null>(null)
const docInput = ref<HTMLInputElement | null>(null)

const idCard = computed(() => documents.value.find((d) => d.kind === 'idCard') ?? null)
const others = computed(() => documents.value.filter((d) => d.kind !== 'idCard'))

const isImage = (d: PilgrimDocument) => !!d.mimeType?.startsWith('image/')
const thumbOf = (d: PilgrimDocument) => d.sizes?.thumbnail?.url || d.url || ''

async function load() {
  loading.value = true
  error.value = ''
  try {
    documents.value = await listDocuments(props.pilgrimId)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Dokümanlar yüklenemedi.'
  } finally {
    loading.value = false
  }
}

async function upload(kind: PilgrimDocumentKind, list: File[]) {
  if (!list.length) return
  uploading.value = kind
  error.value = ''
  try {
    for (const file of list) {
      await uploadDocument(props.pilgrimId, kind, file, kind === 'other' ? note.value.trim() : null)
    }
    if (kind === 'other') note.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Dosya yüklenemedi.'
  } finally {
    uploading.value = null
    if (idInput.value) idInput.value.value = ''
    if (docInput.value) docInput.value.value = ''
    await load()
  }
}

/** Kimlik görseli önce kırpma/döndürme penceresinde açılır; PDF doğrudan yüklenir. */
function pickIdCard(files: FileList | null | undefined) {
  const file = files?.[0]
  if (idInput.value) idInput.value.value = ''
  if (!file) return
  if (file.type.startsWith('image/')) editing.value = file
  else upload('idCard', [file])
}

/** Yüklü kimlik resmini yeniden düzenlemek için indirip pencerede açar. */
async function editIdCard() {
  const doc = idCard.value
  if (!doc?.url) return
  error.value = ''
  try {
    const res = await fetch(doc.url, { credentials: 'include' })
    if (!res.ok) throw new Error()
    const blob = await res.blob()
    editing.value = new File([blob], doc.filename || 'kimlik.jpg', { type: blob.type })
  } catch {
    error.value = 'Kimlik resmi açılamadı.'
  }
}

function onCropped(file: File) {
  editing.value = null
  upload('idCard', [file])
}

async function destroy(doc: PilgrimDocument) {
  const what = doc.kind === 'idCard' ? 'Kimlik resmi' : 'Bu doküman'
  if (!confirm(`${what} silinsin mi?`)) return
  error.value = ''
  try {
    await removeDocument(doc.id)
    if (preview.value?.id === doc.id) preview.value = null
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Silinemedi.'
  }
}

/** Görseller sayfada büyütülür; PDF'ler yeni sekmede açılır. */
function open(doc: PilgrimDocument) {
  if (isImage(doc)) preview.value = doc
  else if (doc.url) window.open(doc.url, '_blank', 'noopener')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') preview.value = null
}

watch(() => props.pilgrimId, load)
onMounted(() => {
  load()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="card block">
    <h2>Kimlik ve dokümanlar</h2>

    <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

    <div class="id-section">
      <h3>Kimlik resmi</h3>
      <div v-if="idCard" class="id-card">
        <button type="button" class="id-image" @click="open(idCard)">
          <img v-if="isImage(idCard)" :src="idCard.url ?? ''" alt="Kimlik resmi" />
          <span v-else class="file-icon">PDF · {{ idCard.filename }}</span>
        </button>
      </div>
      <p v-else-if="!loading" class="muted">Kimlik resmi yüklenmedi.</p>
      <div class="actions-row">
        <input
          ref="idInput"
          type="file"
          accept="image/*,application/pdf"
          hidden
          @change="pickIdCard(($event.target as HTMLInputElement).files)"
        />
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="!!uploading"
          @click="idInput?.click()"
        >
          {{
            uploading === 'idCard'
              ? 'Yükleniyor…'
              : idCard
                ? 'Kimlik resmini değiştir'
                : 'Kimlik resmi yükle'
          }}
        </button>
        <button
          v-if="idCard && isImage(idCard)"
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="!!uploading"
          @click="editIdCard"
        >
          Kırp / döndür
        </button>
        <button v-if="idCard" type="button" class="btn btn-danger btn-sm" @click="destroy(idCard)">
          Sil
        </button>
      </div>
    </div>

    <div class="docs-section">
      <h3>Dokümanlar</h3>
      <p v-if="loading && !documents.length" class="muted">Yükleniyor…</p>
      <p v-else-if="!others.length" class="muted">Henüz doküman eklenmedi.</p>
      <ul v-else class="doc-grid">
        <li v-for="doc in others" :key="doc.id" class="doc">
          <button type="button" class="doc-thumb" @click="open(doc)">
            <img v-if="isImage(doc)" :src="thumbOf(doc)" :alt="doc.note || doc.filename || ''" />
            <span v-else class="file-icon">PDF</span>
          </button>
          <div class="doc-meta">
            <span class="doc-name" :title="doc.filename ?? ''">{{ doc.note || doc.filename }}</span>
            <span class="muted">{{ new Date(doc.createdAt).toLocaleDateString('tr-TR') }}</span>
          </div>
          <button
            type="button"
            class="btn btn-danger btn-sm doc-remove"
            :aria-label="`${doc.filename} sil`"
            @click="destroy(doc)"
          >
            Sil
          </button>
        </li>
      </ul>
      <div class="actions-row">
        <input
          v-model="note"
          class="note-input"
          placeholder="Açıklama (isteğe bağlı, ör. Pasaport)"
          aria-label="Doküman açıklaması"
        />
        <input
          ref="docInput"
          type="file"
          accept="image/*,application/pdf"
          multiple
          hidden
          @change="upload('other', Array.from(($event.target as HTMLInputElement).files ?? []))"
        />
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="!!uploading"
          @click="docInput?.click()"
        >
          {{ uploading === 'other' ? 'Yükleniyor…' : '+ Doküman ekle' }}
        </button>
      </div>
    </div>

    <ImageCropDialog v-if="editing" :file="editing" @done="onCropped" @cancel="editing = null" />

    <div v-if="preview" class="lightbox" role="dialog" aria-modal="true" @click="preview = null">
      <img :src="preview.url ?? ''" :alt="preview.note || preview.filename || ''" @click.stop />
      <div class="lightbox-bar" @click.stop>
        <span>{{
          preview.kind === 'idCard' ? 'Kimlik resmi' : preview.note || preview.filename
        }}</span>
        <a :href="preview.url ?? ''" target="_blank" rel="noopener" class="btn btn-secondary btn-sm"
          >Yeni sekmede aç</a
        >
        <button type="button" class="btn btn-secondary btn-sm" @click="preview = null">
          Kapat
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.block {
  margin-bottom: 1rem;
}

.block h2 {
  font-size: 1.125rem;
  margin-bottom: 1rem;
}

h3 {
  font-size: 0.9375rem;
  margin: 0 0 0.75rem;
}

.alert {
  margin-bottom: 1rem;
}

.id-section {
  margin-bottom: 1.5rem;
}

.id-image,
.doc-thumb {
  display: block;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-background);
  cursor: zoom-in;
  overflow: hidden;
}

.id-image {
  max-width: 100%;
  line-height: 0;
}

.id-image img {
  display: block;
  max-width: 420px;
  max-height: 280px;
}

@media (max-width: 480px) {
  .id-image img {
    max-width: 100%;
  }
}

.actions-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.note-input {
  flex: 1;
  min-width: 200px;
  max-width: 360px;
  padding: 0.375rem 0.625rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-size: 0.875rem;
}

.doc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.doc {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.doc-thumb {
  width: 100%;
  aspect-ratio: 4 / 3;
}

.doc-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.file-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 4rem;
  padding: 0.5rem 1rem;
  font-weight: 600;
  color: var(--color-muted);
}

.doc-meta {
  display: flex;
  flex-direction: column;
  font-size: 0.8125rem;
  min-width: 0;
}

.doc-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-remove {
  align-self: flex-start;
}

.lightbox {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 1rem;
  background: rgb(0 0 0 / 0.8);
}

.lightbox img {
  max-width: 100%;
  max-height: calc(100vh - 6rem);
  object-fit: contain;
  border-radius: var(--radius);
}

.lightbox-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  color: #fff;
}
</style>
