// Geliştirme ortamını tek komutla ve tek porttan (630) çalıştırır:
//  - Next.js / Payload (API + /admin) iç portta: 631
//  - Vite (Vue arayüzü) 630'da; /api, /admin ve /_next isteklerini Next'e proxy'ler.
import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const bin = (p) => fileURLToPath(new URL(`../node_modules/${p}`, import.meta.url))
const nextBin = bin('next/dist/bin/next')
const viteBin = bin('vite/bin/vite.js')

const APP_PORT = 630
const PAYLOAD_PORT = Number(process.env.PAYLOAD_DEV_PORT || 631)

/** Port boşsa true döner (IPv4 ve IPv6 localhost'u da kontrol eder). */
async function isPortFree(port) {
  for (const host of ['127.0.0.1', '::1', '0.0.0.0', '::']) {
    const free = await new Promise((resolve) => {
      const server = net.createServer()
      server.once('error', (err) => resolve(err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL'))
      server.once('listening', () => server.close(() => resolve(true)))
      server.listen(port, host)
    })
    if (!free) return false
  }
  return true
}

const busy = []
for (const port of [APP_PORT, PAYLOAD_PORT]) {
  if (!(await isPortFree(port))) busy.push(port)
}
if (busy.length) {
  console.error(
    `\n✖ Port ${busy.join(' ve ')} zaten kullanımda. Muhtemelen başka bir "npm run dev" açık.\n` +
      `  Onu kapatın (Ctrl+C) ya da süreci bulup sonlandırın:\n` +
      busy.map((p) => `    netstat -ano | findstr :${p}   →   taskkill /PID <pid> /T /F`).join('\n') +
      '\n',
  )
  process.exit(1)
}

const children = [
  spawn(process.execPath, [nextBin, 'dev', '-p', String(PAYLOAD_PORT)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: '--no-deprecation' },
  }),
  spawn(process.execPath, [viteBin], { stdio: 'inherit' }),
]

// Next kendi alt süreçlerini açar; Windows'ta child.kill() bunları öksüz bırakır
// ve sonraki "npm run dev" portu dolu bulur. Bu yüzden tüm ağaç sonlandırılır.
function killTree(child) {
  if (child.exitCode !== null || child.pid === undefined) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
}

let shuttingDown = false
function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  children.forEach(killTree)
  process.exit(code)
}

for (const child of children) {
  child.on('exit', (code) => shutdown(code ?? 0))
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
