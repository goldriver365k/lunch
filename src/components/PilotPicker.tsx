import type { PilotAreaId } from '../types';
import { PILOT_AREAS } from '../data/pilotAreas';

interface Props {
  label: string;
  selected?: PilotAreaId | null;
  onPick: (id: PilotAreaId) => void;
}

/** 선릉·판교·여의도 시범 위치 버튼 */
export function PilotPicker({ label, selected = null, onPick }: Props) {
  return (
    <div className="pilot-picker" role="group" aria-label={label}>
      {PILOT_AREAS.map((a) => (
        <button
          key={a.id}
          type="button"
          aria-pressed={selected === a.id}
          className={selected === a.id ? 'chip active' : 'chip'}
          onClick={() => onPick(a.id)}
        >
          📍 {a.name}
        </button>
      ))}
    </div>
  );
}
