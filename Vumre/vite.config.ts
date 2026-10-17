import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const payloadUrl = env.VITE_PAYLOAD_URL || 'http://localhost:631'

  // Host başlığı korunur (changeOrigin: false): Next'in Server Action Origin/Host kontrolü
  // ve Payload cookie'leri, uygulama 630'dan açılmış gibi çalışır.
  const toPayload: ProxyOptions = { target: payloadUrl, changeOrigin: false, ws: true }

  return {
    plugins: [vue(), vueJsx(), vueDevTools()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    // Build çıktısı Next'in public klasörüne yazılır; Next tek portta hem Vue arayüzünü
    // hem Payload'u sunar. public kaynak olarak da kullanılırsa kendi içine kopyalanır.
    publicDir: command === 'build' ? false : 'public',
    build: {
      outDir: 'public',
      emptyOutDir: false,
      assetsDir: 'spa',
    },
    server: {
      // Uygulamanın tek giriş noktası. Payload (API + /admin) arka planda 631'de çalışır.
      port: 630,
      strictPort: true,
      proxy: {
        '/api': toPayload,
        '/admin': toPayload,
        '/_next': toPayload,
        '/__nextjs': toPayload,
      },
    },
  }
})
