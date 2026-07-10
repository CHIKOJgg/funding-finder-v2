/// <reference types="vite/client" />

interface ImportMetaEnv {
  VITE_API_URL: string | undefined;
  VITE_SENTRY_DSN: string | undefined;
  VITE_NODE_ENV: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
