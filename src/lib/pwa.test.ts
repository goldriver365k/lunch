/// <reference types="node" />
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { installPlatform } from './pwa';
import { sendUsage, usageArea } from './usage';
import { STATIONS } from '../data/stations';
import { destinationPoint } from './geo';

const root = resolve(__dirname, '../..');

/** PNG 헤더에서 크기 읽기 */
function pngSize(path: string): [number, number] {
  const b = readFileSync(path);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe('PWA 설치 설정', () => {
  it('manifest: 이름·설명·시작 주소·standalone·아이콘(192·512·maskable)', () => {
    const m = JSON.parse(readFileSync(resolve(root, 'public/manifest.webmanifest'), 'utf8'));
    expect(m).toMatchObject({ name: '점심뭐먹', short_name: '점심뭐먹', description: '지금 다들 뭐 먹어?', display: 'standalone', scope: '/' });
    expect(m.start_url.startsWith('/')).toBe(true);
    const sizes = (m.icons as { src: string; sizes: string; purpose: string }[]).map((i) => {
      const file = resolve(root, 'public', i.src.replace(/^\//, ''));
      expect(existsSync(file)).toBe(true);
      expect(pngSize(file).join('x')).toBe(i.sizes);
      return `${i.sizes}:${i.purpose}`;
    });
    expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
    expect(pngSize(resolve(root, 'public/icons/apple-touch-icon-180.png'))).toEqual([180, 180]);
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('rel="apple-touch-icon"');
  });

  it('서비스 워커는 같은 주소의 정적 파일만 다루고 API·외부 요청은 캐시하지 않는다', () => {
    const sw = readFileSync(resolve(root, 'public/sw.js'), 'utf8');
    expect(sw).toContain('if (url.origin !== self.location.origin) return;');
    expect(sw).toContain("req.mode === 'navigate'");
    expect(sw).toMatch(/fetch\(req\)[\s\S]*catch/); // 화면은 네트워크 먼저
    expect(sw).not.toMatch(/supabase|rest\/v1|auth\/v1/);
  });

  it('설치 안내: 크롬 설치창 / 아이폰 공유 메뉴 / 안드로이드 메뉴', () => {
    expect(installPlatform('Mozilla/5.0 (Linux; Android 14) Chrome/130', true)).toBe('prompt');
    expect(installPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', false)).toBe('ios');
    expect(installPlatform('Mozilla/5.0 (Linux; Android 14) SamsungBrowser/25', false)).toBe('android-menu');
    expect(installPlatform('Mozilla/5.0 (Windows NT 10.0) Firefox/130', false)).toBe('other');
  });
});

describe('이용 통계', () => {
  it('좌표 대신 가까운 시범 지역 이름만 (1.5km 밖은 other)', () => {
    expect(usageArea(destinationPoint(STATIONS.yeoksam.point, 300, 90))).toBe('yeoksam');
    expect(usageArea(destinationPoint(STATIONS.pangyo.point, 1400, 0))).toBe('pangyo');
    expect(usageArea({ lat: 35.18, lng: 129.07 })).toBe('other');
    expect(usageArea(null)).toBe('unknown');
  });

  it('서버로 보내는 값에 좌표가 없다', () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    sendUsage({ rpc } as unknown as SupabaseClient, 'search', { mode: 'walk', point: STATIONS.seolleung.point, test: true });
    const args = (rpc.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(args).toMatchObject({ p_event: 'search', p_mode: 'walk', p_area: 'seolleung', p_test: true });
    expect(JSON.stringify(args)).not.toContain('37.50');
    expect(args.p_visitor).toBe(localStorage.getItem('mwomeok.visitor'));
  });
});

describe('새 버전 확인', () => {
  it('서비스 워커 주소의 빌드 ID를 읽어 지금 화면과 비교한다', async () => {
    const { workerBuildId } = await import('./pwa');
    expect(workerBuildId('https://lunch.example/sw.js?v=abc123-x1')).toBe('abc123-x1');
    expect(workerBuildId(undefined)).toBeNull();
    expect(workerBuildId('nope')).toBeNull();
  });
});
