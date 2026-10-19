/** 홈 화면 설치(PWA)와 새 버전 반영 */

/** 서비스 워커 주소의 ?v= 값 (빌드 ID) */
export function workerBuildId(scriptUrl: string | undefined | null): string | null {
  if (!scriptUrl) return null;
  try {
    return new URL(scriptUrl).searchParams.get('v');
  } catch {
    return null;
  }
}

/**
 * 운영 빌드에서만 서비스 워커를 등록한다. 빌드마다 주소(?v=)가 달라 새 버전이 설치된다.
 * 화면을 오래 열어 둔 사이 새 버전이 배포되면, 지금 화면보다 새 워커가 들어온 경우에만 새로고침을 권한다.
 */
export function registerServiceWorker(onUpdated: () => void): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const current = __APP_BUILD__.buildId;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    const next = workerBuildId(navigator.serviceWorker.controller?.scriptURL);
    if (next && next !== current) onUpdated();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(current)}`)
      .then((reg) => {
        // 열어 둔 화면에서도 30분마다(보일 때만) 새 버전을 확인한다
        setInterval(() => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        }, 30 * 60 * 1000);
      })
      .catch(() => {
        // 등록 실패해도 앱은 그대로 쓸 수 있다
      });
  });
}

export type InstallPlatform = 'installed' | 'prompt' | 'ios' | 'android-menu' | 'other';

interface NavigatorStandalone extends Navigator {
  standalone?: boolean;
}

export function isStandalone(): boolean {
  return (
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
    (navigator as NavigatorStandalone).standalone === true
  );
}

/** 설치 안내 방식. iOS에는 자동 설치 창이 없으므로 공유 메뉴 안내만 한다 */
export function installPlatform(ua: string, hasPrompt: boolean): InstallPlatform {
  if (isStandalone()) return 'installed';
  if (hasPrompt) return 'prompt';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android-menu';
  return 'other';
}
