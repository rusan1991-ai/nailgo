/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Базовый URL API. По умолчанию — относительный /api (проксируется Vite в dev). */
  readonly VITE_API_URL?: string;
  /** Публичные соцсети показываются только если владелец проекта указал реальные URL. */
  readonly VITE_PUBLIC_VK_URL?: string;
  readonly VITE_PUBLIC_TELEGRAM_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
