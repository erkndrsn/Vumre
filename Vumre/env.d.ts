/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PAYLOAD_URL: string
  readonly VITE_PAYLOAD_AUTH_COLLECTION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
