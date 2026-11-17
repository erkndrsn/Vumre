<script setup lang="ts">
// Listelerdeki kimlik küçük resmi: görsel tıklanınca sayfada büyütülür, PDF yeni sekmede açılır.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { IdCard } from '@/types/payload'

const props = defineProps<{ card: IdCard | null; name: string }>()

const open = ref(false)
const isImage = computed(() => !!props.card?.mimeType?.startsWith('image/'))

function show() {
  if (!props.card) return
  if (isImage.value) open.value = true
  else window.open(props.card.url, '_blank', 'noopener')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}

watch(open, (on) =>
  on ? window.addEventListener('keydown', onKey) : window.removeEventListener('keydown', onKey),
)
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <button
    v-if="card"
    type="button"
    class="id-thumb"
    :aria-label="`${name} kimlik resmini aç`"
    @click.stop="show"
  >
    <img v-if="isImage" :src="card.thumbnailUrl || card.url" alt="" loading="lazy" />
    <span v-else class="file-icon">PDF</span>
  </button>
  <span v-else class="badge">Yok</span>

  <Teleport to="body">
    <div v-if="open && card" class="lightbox" role="dialog" aria-modal="true" @click="open = false">
      <img :src="card.url" :alt="`${name} kimlik resmi`" @click.stop />
      <div class="lightbox-bar" @click.stop>
        <span>{{ name }}</span>
        <a :href="card.url" target="_blank" rel="noopener" class="btn btn-secondary btn-sm"
          >Yeni sekmede aç</a
        >
        <button type="button" class="btn btn-secondary btn-sm" @click="open = false">Kapat</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.id-thumb {
  display: block;
  width: 64px;
  height: 42px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: calc(var(--radius) - 2px);
  background: var(--color-background);
  cursor: zoom-in;
  overflow: hidden;
  transition: transform 0.12s ease;
}

.id-thumb:hover {
  transform: scale(1.05);
  border-color: var(--color-primary);
}

.id-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.file-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-muted);
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
  max-height: calc(100dvh - 6rem);
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
