import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(__filename)

const nextConfig: NextConfig = {
  serverExternalPackages: ['exceljs'],
  images: {
    localPatterns: [
      {
        pathname: '/api/media/file/**',
      },
    ],
  },
  // Vue arayüzü (vite build → public/index.html) aynı porttan sunulur.
  // /api ve /admin Payload rotalarıdır; geri kalan her yol SPA'ya düşer.
  // /spa/ (Vite chunk'ları) hariç: eksik bir chunk index.html değil 404 dönsün.
  async rewrites() {
    return {
      beforeFiles: [{ source: '/', destination: '/index.html' }],
      afterFiles: [],
      fallback: [{ source: '/:path((?!api/|admin|_next/|spa/).*)', destination: '/index.html' }],
    }
  },
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
  turbopack: {
    root: path.resolve(dirname),
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
