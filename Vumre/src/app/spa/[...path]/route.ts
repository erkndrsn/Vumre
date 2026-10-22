import { readFile } from 'fs/promises'
import path from 'path'

// Next production'da public/ klasörünün listesini yalnızca açılışta çıkarır; sonradan
// `vite build` ile eklenen chunk'lar public'ten sunulmaz ve bu route'a düşer. Böylece
// yalnızca Vue arayüzü değiştiğinde sunucuyu yeniden başlatmak gerekmez.
const SPA_DIR = path.join(process.cwd(), 'public', 'spa')

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const segments = (await params).path
  const filePath = path.resolve(SPA_DIR, ...segments)
  const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()]
  if (!contentType || !filePath.startsWith(SPA_DIR + path.sep)) {
    return new Response('Not found', { status: 404 })
  }

  try {
    const body = await readFile(filePath)
    return new Response(body, {
      headers: {
        'Content-Type': contentType,
        // Vite dosya adları içerik hash'i taşır; içerik değişirse ad da değişir.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
