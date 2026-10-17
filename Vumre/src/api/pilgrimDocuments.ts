import type { PilgrimDocument, PilgrimDocumentKind } from '@/types/payload'
import { create, find, remove } from './collections'

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
