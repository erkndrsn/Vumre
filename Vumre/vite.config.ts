import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const payloadUrl = env.VITE_PAYLOAD_URL || 'http://localhost:3000'

  return {
    plugins: [vue(), vueJsx(), vueDevTools()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      // Payload'a giden istekleri aynı origin üzerinden geçir: CORS ve cookie sorunlarını önler.
      proxy: {
        '/api': { target: payloadUrl, changeOrigin: true },
      },
    },
    preview: {
      proxy: {
        '/api': { target: payloadUrl, changeOrigin: true },
      },
    },
  }
})
