import type { PilotAreaId } from '../types';
import { PilotPicker } from './PilotPicker';

/** 'current' = 현재 위치, 그 외 = 시범 지역 */
export type DeliveryTarget = 'current' | PilotAreaId;

interface Props {
  target: DeliveryTarget;
  currentAvailable: boolean;
  detail: string;
  onTargetChange: (target: DeliveryTarget) => void;
  onDetailChange: (detail: string) => void;
}

export function DeliveryAddressPanel({ target, currentAvailable, detail, onTargetChange, onDetailChange }: Props) {
  return (
    <section className="location-panel" aria-label="배달 주소">
      <p className="location-line">
        🏠 <strong>배달 주소</strong>
        <span className="muted"> · 이 주소에서 배달 가능한 가게를 보여줘요</span>
      </p>
      <div className="pilot-picker" role="group" aria-label="배달 주소 선택">
        <button
          type="button"
          aria-pressed={target === 'current'}
          className={target === 'current' ? 'chip active' : 'chip'}
          disabled={!currentAvailable}
          onClick={() => onTargetChange('current')}
        >
          🧭 현재 위치
        </button>
        <PilotPicker label="시범 지역" selected={target === 'current' ? null : target} onPick={onTargetChange} />
      </div>
      <input
        type="text"
        className="search detail-input"
        placeholder="상세 주소 (예: 101동 1203호)"
        aria-label="상세 주소"
        value={detail}
        onChange={(e) => onDetailChange(e.target.value)}
      />
      <p className="location-help">상세 주소는 시연용 입력란이에요. 저장하거나 전송하지 않아요.</p>
    </section>
  );
}
