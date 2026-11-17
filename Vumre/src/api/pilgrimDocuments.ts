import type { IdCard, PilgrimDocument, PilgrimDocumentKind } from '@/types/payload'
import { create, find, remove } from './collections'

/**
 * Okunabilen tüm kimlik resimleri, umreci id'sine göre. Her umrecinin en fazla bir kimliği olur.
 * `url` dosya adından hesaplandığı için `filename` da seçilmeli.
 */
export async function listIdCards() {
  const res = await find<PilgrimDocument>('pilgrim-documents', {
    limit: 0,
    depth: 0,
    where: { kind: { equals: 'idCard' } },
    select: { pilgrim: true, filename: true, url: true, mimeType: true, sizes: true },
  })
  const map = new Map<number, IdCard>()
  for (const d of res.docs) {
    if (!d.url) continue
    const pilgrim = typeof d.pilgrim === 'object' ? d.pilgrim.id : d.pilgrim
    map.set(pilgrim, {
      url: d.url,
      thumbnailUrl: d.sizes?.thumbnail?.url ?? null,
      mimeType: d.mimeType ?? null,
    })
  }
  return map
}

export async function listDocuments(pilgrim: number) {
  const res = await find<PilgrimDocument>('pilgrim-documents', {
    limit: 0,
    depth: 0,
    sort: '-createdAt',
    where: { pilgrim: { equals: pilgrim } },
  })
  return res.docs
}

/** Dosyayı Payload'un beklediği multipart biçimde (`file` + `_payload`) yükler. */
export function uploadDocument(
  pilgrim: number,
  kind: PilgrimDocumentKind,
  file: File,
  note?: string | null,
) {
  const body = new FormData()
  body.append('file', file)
  body.append('_payload', JSON.stringify({ pilgrim, kind, note: note || null }))
  return create<PilgrimDocument>('pilgrim-documents', body)
}

export function removeDocument(id: number) {
  return remove('pilgrim-documents', id)
}
