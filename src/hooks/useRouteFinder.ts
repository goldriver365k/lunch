import { useCallback, useState } from 'react';
import {
  external,
  kakaoAppRouteUrl,
  kakaoWebRouteUrl,
  loadMapProvider,
  naverAppRouteUrl,
  saveMapProvider,
  type MapProvider,
  type RoutePlace,
} from '../lib/mapLinks';

export type RouteTarget = 'kakao-web' | 'kakao-app' | 'naver-app';

export type RouteStep =
  | { kind: 'idle' }
  /** 지도 고르기 — dest가 없으면 설정 변경만 */
  | { kind: 'choose'; dest: RoutePlace | null }
  /** 실제 GPS 출발지가 없음 — 위치 확인 또는 지도에서 출발지 선택 안내 */
  | { kind: 'no-origin'; dest: RoutePlace; target: RouteTarget }
  /** 네이버지도 앱 호출 뒤 — 앱이 없을 때의 대안 안내 */
  | { kind: 'naver-fallback'; dest: RoutePlace; origin: RoutePlace | null };

const providerTarget = (p: MapProvider): RouteTarget => (p === 'kakao' ? 'kakao-web' : 'naver-app');

/**
 * 매장찾기 흐름.
 * - 처음 한 번만 지도를 고르게 하고 로컬 저장소에 기억한다.
 * - 출발지는 실제 GPS 위치만 쓴다. 없으면 임의로 정하지 않고 안내한다.
 * - 버튼을 눌렀을 때만 외부 지도로 연결한다.
 */
export function useRouteFinder(gpsOrigin: RoutePlace | null) {
  const [provider, setProvider] = useState<MapProvider | null>(loadMapProvider);
  const [step, setStep] = useState<RouteStep>({ kind: 'idle' });

  const launch = useCallback((dest: RoutePlace, target: RouteTarget, origin: RoutePlace | null) => {
    if (target === 'kakao-web') {
      external.openWeb(kakaoWebRouteUrl(dest, origin));
      setStep({ kind: 'idle' });
    } else if (target === 'kakao-app') {
      external.openApp(kakaoAppRouteUrl(dest, origin));
      setStep({ kind: 'idle' });
    } else {
      external.openApp(naverAppRouteUrl(dest, origin, window.location.origin));
      setStep({ kind: 'naver-fallback', dest, origin });
    }
  }, []);

  const proceed = useCallback(
    (dest: RoutePlace, target: RouteTarget) => {
      if (!gpsOrigin) setStep({ kind: 'no-origin', dest, target });
      else launch(dest, target, gpsOrigin);
    },
    [gpsOrigin, launch],
  );

  /** 매장찾기 — 저장된 지도로 바로 연결, 없으면 지도 선택부터 */
  const findRoute = useCallback(
    (dest: RoutePlace, target?: RouteTarget) => {
      if (target) proceed(dest, target);
      else if (provider) proceed(dest, providerTarget(provider));
      else setStep({ kind: 'choose', dest });
    },
    [provider, proceed],
  );

  const chooseProvider = useCallback(
    (p: MapProvider) => {
      saveMapProvider(p);
      setProvider(p);
      if (step.kind === 'choose' && step.dest) proceed(step.dest, providerTarget(p));
      else setStep({ kind: 'idle' });
    },
    [step, proceed],
  );

  const openWithoutOrigin = useCallback(() => {
    if (step.kind === 'no-origin') launch(step.dest, step.target, null);
  }, [step, launch]);

  const switchToKakaoWeb = useCallback(() => {
    if (step.kind === 'naver-fallback') launch(step.dest, 'kakao-web', step.origin);
  }, [step, launch]);

  const changeProvider = useCallback(() => setStep({ kind: 'choose', dest: null }), []);
  const close = useCallback(() => setStep({ kind: 'idle' }), []);

  return { provider, step, findRoute, chooseProvider, changeProvider, openWithoutOrigin, switchToKakaoWeb, close };
}
