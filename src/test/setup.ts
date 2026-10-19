import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';

// 기존 화면 테스트는 ‘현재 위치로 찾기’에 이미 동의한 기기를 기준으로 한다.
// 처음 방문(동의 전) 흐름은 App.pwa.test.tsx에서 따로 시험한다.
beforeEach(() => {
  try {
    localStorage.setItem('mwomeok.locationConsent', '1');
  } catch {
    // 저장소가 없는 환경
  }
});
