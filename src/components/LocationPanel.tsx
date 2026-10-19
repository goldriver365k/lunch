import { useState } from 'react';
import type { PilotAreaId } from '../types';
import type { LocationState } from '../hooks/useCurrentLocation';
import { PilotPicker } from './PilotPicker';

interface Props {
  state: LocationState;
  areaName: string | null;
  onRetry: () => void;
  onPickPilot: (id: PilotAreaId) => void;
}

export function LocationPanel({ state, areaName, onRetry, onPickPilot }: Props) {
  const [changing, setChanging] = useState(false);

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
        <p className="location-help">시범 위치를 골라 둘러볼 수 있어요.</p>
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
