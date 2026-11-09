<script setup lang="ts">
// Tahsilat tablolarındaki dekont hücresi: dekontları açar; `editable` ise ekler ve siler.
import { computed, ref } from 'vue'
import { removeReceipt, uploadReceipt } from '@/api/payments'
import type { Payment, PaymentReceipt } from '@/types/payload'

const props = defineProps<{ payment: Payment; editable?: boolean }>()
const emit = defineEmits<{ changed: []; error: [message: string] }>()

const input = ref<HTMLInputElement | null>(null)
const busy = ref(false)

const receipts = computed(() =>
  (props.payment.receipts?.docs ?? []).filter(
    (r): r is PaymentReceipt => typeof r === 'object' && r !== null,
  ),
)

const isImage = (r: PaymentReceipt) => !!r.mimeType?.startsWith('image/')
const label = (r: PaymentReceipt, i: number) =>
  receipts.value.length > 1 ? `Dekont ${i + 1}` : 'Dekont'

async function add(files: File[]) {
  if (!files.length) return
  busy.value = true
  try {
    for (const file of files) await uploadReceipt(props.payment.id, file)
  } catch (e) {
    emit('error', e instanceof Error ? e.message : 'Dekont yüklenemedi.')
  } finally {
    busy.value = false
    if (input.value) input.value.value = ''
    emit('changed')
  }
}

async function destroy(r: PaymentReceipt) {
  if (!confirm(`${r.filename ?? 'Dekont'} silinsin mi?`)) return
  busy.value = true
  try {
    await removeReceipt(r.id)
  } catch (e) {
    emit('error', e instanceof Error ? e.message : 'Dekont silinemedi.')
  } finally {
    busy.value = false
    emit('changed')
  }
}
</script>

<template>
  <div class="receipts">
    <span v-for="(r, i) in receipts" :key="r.id" class="receipt">
      <a :href="r.url ?? ''" target="_blank" rel="noopener" :title="r.filename ?? ''">
        <img v-if="isImage(r)" :src="r.sizes?.thumbnail?.url || r.url || ''" alt="" />
        <span v-else class="pdf">PDF</span>
        {{ label(r, i) }}
      </a>
      <button
        v-if="editable"
        type="button"
        class="remove"
        :disabled="busy"
        :aria-label="`${label(r, i)} sil`"
        @click="destroy(r)"
      >
        ×
      </button>
    </span>
    <span v-if="!receipts.length && !editable">—</span>
    <template v-if="editable">
      <input
        ref="input"
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        @change="add(Array.from(($event.target as HTMLInputElement).files ?? []))"
      />
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        :disabled="busy"
        @click="input?.click()"
      >
        {{ busy ? 'Yükleniyor…' : '+ Dekont' }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.receipts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
}

.receipt {
  display: inline-flex;
  align-items: center;
  gap: 0.125rem;
}

.receipt a {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  white-space: nowrap;
}

.receipt img,
.pdf {
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  object-fit: cover;
}

.pdf {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--color-muted);
}

.remove {
  padding: 0 0.25rem;
  border: 0;
  background: none;
  color: var(--color-error);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
}
</style>
