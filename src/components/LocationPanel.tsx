import { useState } from 'react';
import type { PilotAreaId } from '../types';
import type { LocationState } from '../hooks/useCurrentLocation';
import { PilotPicker } from './PilotPicker';

/** GPS 정확도가 이보다 크면(미터) 재확인을 안내한다 */
export const LOW_ACCURACY_M = 100;

interface Props {
  state: LocationState;
  /** 가상 데이터 시범 지역 이름 — null이면 '현재 위치 주변에 가상 매장 배치' 안내, ''면 안내 없음 */
  areaName: string | null;
  onRetry: () => void;
  onPickPilot: (id: PilotAreaId) => void;
  /** 위치·개인정보 안내 열기 */
  onShowPrivacy?: () => void;
}

export function LocationPanel({ state, areaName, onRetry, onPickPilot, onShowPrivacy }: Props) {
  const [changing, setChanging] = useState(false);

  if (state.status === 'ask') {
    // 권한을 요청하기 전에 용도를 먼저 알린다. 위치 없이도 지역을 골라 바로 볼 수 있다
    return (
      <section className="location-panel ask" aria-label="위치 사용 안내">
        <p className="location-line">📍 내 주변 점심을 찾으려면 현재 위치가 필요해요</p>
        <p className="location-help">
          위치는 이 휴대폰에서 거리 계산에만 쓰고, 서버에 위치 기록을 남기지 않아요.
          {onShowPrivacy && (
            <>
              {' '}
              <button type="button" className="link-button inline" onClick={onShowPrivacy}>
                자세히
              </button>
            </>
          )}
        </p>
        <button type="button" className="primary-button" onClick={onRetry}>
          현재 위치로 찾기
        </button>
        <PilotPicker label="또는 지역 직접 선택" onPick={onPickPilot} />
      </section>
    );
  }

  if (state.status === 'locating') {
    return (
      <section className="location-panel" aria-live="polite">
        <p className="location-line">📡 현재 위치를 확인하는 중…</p>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="location-panel error" role="alert">
        <p className="location-line">⚠️ {state.reason}</p>
        <p className="location-help">지역을 직접 골라 둘러볼 수 있어요.</p>
        <PilotPicker label="시범 위치 선택" onPick={onPickPilot} />
        <button type="button" className="link-button" onClick={onRetry}>
          GPS 다시 시도
        </button>
      </section>
    );
  }

  const { location } = state;
  return (
    <section className="location-panel">
      <div className="location-row">
        <p className="location-line">
          📍 <strong>{location.label}</strong>
          {location.source === 'gps' && location.accuracyM !== undefined && (
            <span className="muted"> · GPS 정확도 ±{location.accuracyM}m</span>
          )}
        </p>
        <button
          type="button"
          className="link-button"
          aria-expanded={changing}
          onClick={() => setChanging((v) => !v)}
        >
          {changing ? '닫기' : '위치 변경'}
        </button>
      </div>
      {location.source === 'gps' && location.accuracyM !== undefined && location.accuracyM > LOW_ACCURACY_M && (
        <p className="location-warn" role="status">
          위치 정확도가 낮아요(±{location.accuracyM}m). 실내라면 창가나 밖에서{' '}
          <button type="button" className="link-button inline" onClick={onRetry}>
            위치 다시 확인
          </button>
        </p>
      )}
      {areaName === null && (
        <p className="location-help">시범 지역 밖이라 현재 위치 주변에 가상 매장을 배치했어요.</p>
      )}
      {changing && (
        <div className="location-change">
          <PilotPicker
            label="시범 위치 선택"
            onPick={(id) => {
              onPickPilot(id);
              setChanging(false);
            }}
          />
          <button
            type="button"
            className="link-button"
            onClick={() => {
              onRetry();
              setChanging(false);
            }}
          >
            GPS로 다시 찾기
          </button>
        </div>
      )}
    </section>
  );
}
