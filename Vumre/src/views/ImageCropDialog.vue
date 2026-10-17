<script setup lang="ts">
// Yüklemeden önce görseli kırpma ve döndürme penceresi (kimlik resmi için).
// Döndürülmüş görsel bir canvas'a çizilir; kırpma alanı bu canvas üzerinde 0-1 aralığında tutulur.
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

const props = defineProps<{ file: File }>()
const emit = defineEmits<{ done: [file: File]; cancel: [] }>()

/** İşlem hızı ve dosya boyutu için kaynak görsel bu boyuta küçültülür. */
const MAX_SIDE = 2400
const MIN_SIZE = 0.05
/** TC kimlik kartı ölçüsü (85,6 × 54 mm). */
const ID_CARD_RATIO = 85.6 / 54

interface Rect {
  x: number
  y: number
  w: number
  h: number
}
type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se'

const canvas = ref<HTMLCanvasElement | null>(null)
const box = ref<HTMLDivElement | null>(null)
const image = ref<HTMLImageElement | null>(null)
const error = ref('')
const saving = ref(false)

const quarter = ref(0)
const fine = ref(0)
const aspect = ref<'free' | 'idCard'>('free')
const rect = reactive<Rect>({ x: 0, y: 0, w: 1, h: 1 })
const size = reactive({ width: 1, height: 1 })

const angle = computed(() => quarter.value * 90 + fine.value)
const ratio = computed(() => (aspect.value === 'idCard' ? ID_CARD_RATIO : null))

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

/** Görseli geçerli açıyla canvas'a çizer; canvas döndürülmüş görseli tamamen kapsar. */
function draw() {
  const img = image.value
  const el = canvas.value
  if (!img || !el) return
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
  const w = img.naturalWidth * scale
  const h = img.naturalHeight * scale
  const rad = (angle.value * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  el.width = Math.round(w * cos + h * sin)
  el.height = Math.round(w * sin + h * cos)
  size.width = el.width
  size.height = el.height
  const ctx = el.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, el.width, el.height)
  ctx.translate(el.width / 2, el.height / 2)
  ctx.rotate(rad)
  ctx.drawImage(img, -w / 2, -h / 2, w, h)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

/** Kırpma alanını seçili orana göre ortalanmış en büyük dikdörtgene getirir. */
function resetRect() {
  const r = ratio.value
  if (!r) {
    Object.assign(rect, { x: 0.05, y: 0.05, w: 0.9, h: 0.9 })
    return
  }
  // Normalize genişlik/yükseklik oranı: (w·W)/(h·H) = r
  let w = 0.9
  let h = (w * size.width) / (r * size.height)
  if (h > 0.9) {
    h = 0.9
    w = (h * r * size.height) / size.width
  }
  Object.assign(rect, { x: (1 - w) / 2, y: (1 - h) / 2, w, h })
}

function rotate(step: 1 | -1) {
  quarter.value = (quarter.value + step + 4) % 4
}

function reset() {
  quarter.value = 0
  fine.value = 0
  aspect.value = 'free'
  draw()
  resetRect()
}

watch(quarter, () => {
  draw()
  resetRect()
})
// İnce ayarda kırpma alanı korunur; yalnızca canvas sınırına sığdırılır.
watch(fine, () => {
  draw()
  if (ratio.value) resetRect()
  else {
    rect.w = Math.min(rect.w, 1)
    rect.h = Math.min(rect.h, 1)
    rect.x = clamp(rect.x, 0, 1 - rect.w)
    rect.y = clamp(rect.y, 0, 1 - rect.h)
  }
})
watch(aspect, resetRect)

// Sürükleme
let drag: { handle: Handle; startX: number; startY: number; start: Rect } | null = null

function startDrag(handle: Handle, e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  drag = { handle, startX: e.clientX, startY: e.clientY, start: { ...rect } }
}

function onDrag(e: PointerEvent) {
  if (!drag || !box.value) return
  const bounds = box.value.getBoundingClientRect()
  const dx = (e.clientX - drag.startX) / bounds.width
  const dy = (e.clientY - drag.startY) / bounds.height
  const s = drag.start

  if (drag.handle === 'move') {
    rect.x = clamp(s.x + dx, 0, 1 - s.w)
    rect.y = clamp(s.y + dy, 0, 1 - s.h)
    return
  }

  const west = drag.handle.includes('w')
  const north = drag.handle.includes('n')
  let left = s.x
  let right = s.x + s.w
  let top = s.y
  let bottom = s.y + s.h
  if (west) left = clamp(left + dx, 0, right - MIN_SIZE)
  else right = clamp(right + dx, left + MIN_SIZE, 1)
  if (north) top = clamp(top + dy, 0, bottom - MIN_SIZE)
  else bottom = clamp(bottom + dy, top + MIN_SIZE, 1)

  const r = ratio.value
  if (r) {
    // Genişlik esas alınır, yükseklik orana göre hesaplanır; taşarsa yükseklikten geri gidilir.
    let w = right - left
    let h = (w * size.width) / (r * size.height)
    const maxH = north ? bottom : 1 - top
    if (h > maxH) {
      h = maxH
      w = (h * r * size.height) / size.width
      if (west) left = right - w
      else right = left + w
    }
    if (north) top = bottom - h
    else bottom = top + h
  }
  Object.assign(rect, { x: left, y: top, w: right - left, h: bottom - top })
}

function endDrag() {
  drag = null
}

function save() {
  const el = canvas.value
  if (!el) return
  saving.value = true
  const sx = Math.round(rect.x * el.width)
  const sy = Math.round(rect.y * el.height)
  const sw = Math.max(1, Math.round(rect.w * el.width))
  const sh = Math.max(1, Math.round(rect.h * el.height))
  const out = document.createElement('canvas')
  out.width = sw
  out.height = sh
  out.getContext('2d')!.drawImage(el, sx, sy, sw, sh, 0, 0, sw, sh)
  out.toBlob(
    (blob) => {
      saving.value = false
      if (!blob) {
        error.value = 'Görsel işlenemedi.'
        return
      }
      const name = props.file.name.replace(/\.[^.]+$/, '') || 'kimlik'
      emit('done', new File([blob], `${name}.jpg`, { type: 'image/jpeg' }))
    },
    'image/jpeg',
    0.9,
  )
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('cancel')
}

let objectUrl = ''
onMounted(() => {
  window.addEventListener('keydown', onKey)
  objectUrl = URL.createObjectURL(props.file)
  const img = new Image()
  img.onload = () => {
    image.value = img
    draw()
    resetRect()
  }
  img.onerror = () => {
    error.value = 'Görsel açılamadı. Desteklenen bir resim dosyası seçin.'
  }
  img.src = objectUrl
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  URL.revokeObjectURL(objectUrl)
})

const pct = (v: number) => `${v * 100}%`
</script>

<template>
  <div class="crop-dialog" role="dialog" aria-modal="true" aria-label="Kimlik resmini düzenle">
    <div class="crop-panel card">
      <h2>Kimlik resmini düzenle</h2>
      <div v-if="error" class="alert alert-error" role="alert">{{ error }}</div>

      <div class="stage">
        <div ref="box" class="canvas-box" :class="{ ready: !!image }">
          <canvas ref="canvas" />
          <div
            v-if="image"
            class="crop-rect"
            :style="{
              left: pct(rect.x),
              top: pct(rect.y),
              width: pct(rect.w),
              height: pct(rect.h),
            }"
            @pointerdown.prevent="startDrag('move', $event)"
            @pointermove="onDrag"
            @pointerup="endDrag"
            @pointercancel="endDrag"
          >
            <span
              v-for="h in ['nw', 'ne', 'sw', 'se'] as const"
              :key="h"
              class="handle"
              :class="h"
              @pointerdown.stop.prevent="startDrag(h, $event)"
              @pointermove="onDrag"
              @pointerup="endDrag"
              @pointercancel="endDrag"
            />
          </div>
        </div>
        <p v-if="!image && !error" class="muted">Görsel yükleniyor…</p>
      </div>

      <div class="tools">
        <div class="tool-group">
          <button type="button" class="btn btn-secondary btn-sm" @click="rotate(-1)">
            ↺ Sola döndür
          </button>
          <button type="button" class="btn btn-secondary btn-sm" @click="rotate(1)">
            ↻ Sağa döndür
          </button>
        </div>
        <label class="field fine">
          <span>İnce ayar: {{ fine.toLocaleString('tr-TR') }}°</span>
          <input v-model.number="fine" type="range" min="-15" max="15" step="0.5" />
        </label>
        <label class="field">
          <span>Kırpma oranı</span>
          <select v-model="aspect">
            <option value="free">Serbest</option>
            <option value="idCard">Kimlik kartı</option>
          </select>
        </label>
        <button type="button" class="btn btn-secondary btn-sm" @click="reset">Sıfırla</button>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" @click="emit('cancel')">Vazgeç</button>
        <button type="button" class="btn btn-primary" :disabled="!image || saving" @click="save">
          {{ saving ? 'Hazırlanıyor…' : 'Kırp ve yükle' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.crop-dialog {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgb(0 0 0 / 0.6);
}

.crop-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: min(100%, 900px);
  max-height: calc(100vh - 2rem);
  overflow: auto;
}

.crop-panel h2 {
  font-size: 1.125rem;
  margin: 0;
}

.stage {
  display: flex;
  justify-content: center;
  background: var(--color-background);
  border-radius: var(--radius);
  padding: 0.75rem;
}

.canvas-box {
  position: relative;
  display: inline-block;
  line-height: 0;
  overflow: hidden;
  user-select: none;
}

.canvas-box:not(.ready) {
  display: none;
}

.canvas-box canvas {
  display: block;
  max-width: 100%;
  max-height: 58vh;
}

.crop-rect {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid #fff;
  outline: 1px solid rgb(0 0 0 / 0.4);
  box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.5);
  cursor: move;
  touch-action: none;
}

.handle {
  position: absolute;
  width: 16px;
  height: 16px;
  background: #fff;
  border: 1px solid rgb(0 0 0 / 0.4);
  border-radius: 2px;
  touch-action: none;
}

.handle.nw {
  left: -9px;
  top: -9px;
  cursor: nwse-resize;
}

.handle.ne {
  right: -9px;
  top: -9px;
  cursor: nesw-resize;
}

.handle.sw {
  left: -9px;
  bottom: -9px;
  cursor: nesw-resize;
}

.handle.se {
  right: -9px;
  bottom: -9px;
  cursor: nwse-resize;
}

.tools {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 1rem;
}

.tool-group {
  display: flex;
  gap: 0.5rem;
}

.fine {
  min-width: 200px;
}

.fine input {
  padding: 0;
}
</style>
