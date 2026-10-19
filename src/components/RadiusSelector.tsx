import type { Radius } from '../types';
import { RADII } from '../lib/constants';

interface Props {
  value: Radius;
  onChange: (radius: Radius) => void;
}

export function RadiusSelector({ value, onChange }: Props) {
  return (
    <div className="filter-row" role="radiogroup" aria-label="검색 반경">
      <span className="filter-label">반경</span>
      <div className="segmented">
        {RADII.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={value === r}
            className={value === r ? 'seg active' : 'seg'}
            onClick={() => onChange(r)}
          >
            {r}m
          </button>
        ))}
      </div>
    </div>
  );
}
