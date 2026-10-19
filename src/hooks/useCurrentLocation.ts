import { useCallback, useEffect, useState } from 'react';
import type { ActiveLocation, PilotArea } from '../types';

export type LocationState =
  | { status: 'locating' }
  | { status: 'ready'; location: ActiveLocation }
  | { status: 'error'; reason: string };

const GEO_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 };

export function describeGeoError(err: Pick<GeolocationPositionError, 'code'>): string {
  switch (err.code) {
    case 1:
      return typeof window !== 'undefined' && window.isSecureContext === false
        ? '위치 확인은 HTTPS 또는 localhost 주소에서만 할 수 있어요.'
        : '위치 권한이 거부됐어요. 브라우저 설정에서 위치 권한을 허용해 주세요.';
    case 2:
      return '현재 위치를 찾을 수 없어요.';
    case 3:
      return '위치 확인 시간이 초과됐어요.';
    default:
      return '위치를 확인하지 못했어요.';
  }
}

/** 브라우저 GPS(Geolocation API)로 현재 위치를 확인하고, 실패하면 시범 위치를 고를 수 있게 한다. */
export function useCurrentLocation() {
  const [state, setState] = useState<LocationState>({ status: 'locating' });

  const locate = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState({ status: 'error', reason: '이 브라우저는 위치 확인을 지원하지 않아요.' });
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
      (err) => setState({ status: 'error', reason: describeGeoError(err) }),
      GEO_OPTIONS,
    );
  }, []);

  const choosePilot = useCallback((area: PilotArea) => {
    setState({ status: 'ready', location: { source: 'pilot', label: `${area.name} (시범 위치)`, point: area.center } });
  }, []);

  useEffect(() => {
    locate();
  }, [locate]);

  return { state, locate, choosePilot };
}
