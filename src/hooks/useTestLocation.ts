import { useEffect, useState } from 'react';
import { STATIONS, type Station, type StationId } from '../data/stations';
import { checkIsAdmin } from '../lib/db/restaurantsApi';
import { supabase } from '../lib/supabase';

/** 관리자 페이지에서 고른 테스트 위치 (브라우저 탭 단위로만 기억) */
const KEY = 'mwomeok.testLocation';

export function requestTestLocation(id: StationId | null): void {
  try {
    if (id) sessionStorage.setItem(KEY, id);
    else sessionStorage.removeItem(KEY);
  } catch {
    // 저장소를 쓸 수 없으면 테스트 모드를 쓰지 않는다
  }
}

function readRequested(): StationId | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v && v in STATIONS ? (v as StationId) : null;
  } catch {
    return null;
  }
}

/**
 * 관리자 전용 테스트 위치.
 * 저장된 요청이 있어도 서버(is_admin)에서 관리자임이 확인될 때만 켜진다.
 * 일반 이용자에게는 아무 영향이 없다.
 */
export function useTestLocation() {
  const [requested, setRequested] = useState<StationId | null>(readRequested);
  const [verified, setVerified] = useState<StationId | null>(null);

  useEffect(() => {
    if (!requested || !supabase) return;
    let cancelled = false;
    checkIsAdmin(supabase).then((ok) => {
      if (cancelled) return;
      if (ok) setVerified(requested);
      else {
        requestTestLocation(null);
        setRequested(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [requested]);

  const station: Station | null = requested && verified === requested ? STATIONS[requested] : null;
  const exit = () => {
    requestTestLocation(null);
    setRequested(null);
    setVerified(null);
  };
  return { station, exit };
}
