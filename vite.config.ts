/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** 앱 버전·배포 정보 — 관리자 '운영 현황'에서 확인하고, 서비스 워커 캐시 이름에도 쓴다 */
function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const BUILD = {
  version: pkg.version,
  commit: process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) ?? gitSha(),
  builtAt: new Date().toISOString(),
};
const BUILD_ID = `${BUILD.commit}-${Date.parse(BUILD.builtAt).toString(36)}`;

/** 배포된 버전을 확인할 수 있게 /version.json을 만든다 */
function versionFile(): Plugin {
  return {
    name: 'mwomeok-version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ ...BUILD, buildId: BUILD_ID }) });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionFile()],
  define: {
    __APP_BUILD__: JSON.stringify({ ...BUILD, buildId: BUILD_ID }),
  },
  server: { host: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
});
