import { useCallback, useEffect, useState } from 'react';
import type { ActiveLocation, PilotArea } from '../types';

export type LocationState =
  | { status: 'ask' }
  | { status: 'locating' }
  | { status: 'ready'; location: ActiveLocation }
  | { status: 'error'; reason: string; code: number };

const GEO_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 };

/** 이용자가 '현재 위치로 찾기'를 한 번 눌렀는지 (이 기기에만 저장) */
export const LOCATION_CONSENT_KEY = 'mwomeok.locationConsent';

function hasConsent(): boolean {
  try {
    return localStorage.getItem(LOCATION_CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

function saveConsent(): void {
  try {
    localStorage.setItem(LOCATION_CONSENT_KEY, '1');
  } catch {
    // 저장할 수 없으면 다음에 다시 묻는다
  }
}

export function describeGeoError(err: Pick<GeolocationPositionError, 'code'>): string {
  switch (err.code) {
    case 1:
      return typeof window !== 'undefined' && window.isSecureContext === false
        ? '위치 확인은 HTTPS 또는 localhost 주소에서만 할 수 있어요.'
        : '위치 권한이 거부됐어요. 브라우저 설정에서 위치 권한을 허용해 주세요.';
    case 2:
      return typeof navigator !== 'undefined' && navigator.onLine === false
        ? '인터넷 연결이 없어 위치를 확인하지 못했어요. 연결을 확인해 주세요.'
        : '현재 위치를 찾을 수 없어요.';
    case 3:
      return '위치 확인 시간이 초과됐어요.';
    default:
      return '위치를 확인하지 못했어요.';
  }
}

/**
 * 브라우저 GPS(Geolocation API)로 현재 위치를 확인한다.
 * 처음에는 용도를 설명하고 이용자가 ‘현재 위치로 찾기’를 눌러야 권한을 요청한다.
 * 한 번 동의했거나 브라우저에 이미 권한이 있으면 바로 확인한다. 실패하면 지역을 직접 고를 수 있다.
 */
export function useCurrentLocation() {
  const [state, setState] = useState<LocationState>(() => (hasConsent() ? { status: 'locating' } : { status: 'ask' }));

  const locate = useCallback(() => {
    saveConsent();
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState({ status: 'error', reason: '이 브라우저는 위치 확인을 지원하지 않아요.', code: 0 });
      return;
    }
    // 이미 위치가 있으면 결과가 나올 때까지 그대로 두어 목록·상세화면이 사라지지 않게 한다
    setState((prev) => (prev.status === 'ready' ? prev : { status: 'locating' }));
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setState({
          status: 'ready',
          location: {
            source: 'gps',
            label: '현재 위치',
            point: { lat: pos.coords.latitude, lng: pos.coords.longitude },
            accuracyM: Math.round(pos.coords.accuracy),
          },
        }),
      (err) => setState({ status: 'error', reason: describeGeoError(err), code: err.code }),
      GEO_OPTIONS,
    );
  }, []);

  const choosePilot = useCallback((area: PilotArea) => {
    setState({ status: 'ready', location: { source: 'pilot', label: `${area.name} (시범 위치)`, point: area.center } });
  }, []);

  useEffect(() => {
    if (hasConsent()) {
      locate();
      return;
    }
    // 브라우저에 이미 위치 권한이 있으면 다시 묻지 않는다
    let cancelled = false;
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((p) => {
        if (!cancelled && p.state === 'granted') locate();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [locate]);

  return { state, locate, choosePilot };
}
