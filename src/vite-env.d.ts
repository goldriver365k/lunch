/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase 프로젝트 URL — 비우면 가상 데이터(데모)로 동작 */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon(공개) 키 — 브라우저에 넣어도 되는 키. service_role 키는 절대 넣지 않는다 */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** 빌드 때 넣는 앱 버전·커밋·빌드 시각 (vite.config.ts) */
declare const __APP_BUILD__: { version: string; commit: string; builtAt: string; buildId: string };
