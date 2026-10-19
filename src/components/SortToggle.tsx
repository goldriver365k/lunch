import type { SortKey } from '../types';
import { SORTS } from '../lib/constants';

interface Props {
  value: SortKey;
  onChange: (sort: SortKey) => void;
}

export function SortToggle({ value, onChange }: Props) {
  return (
    <div className="sort-toggle" role="radiogroup" aria-label="정렬">
      {SORTS.map((s) => (
        <button
          key={s.key}
          type="button"
          role="radio"
          aria-checked={value === s.key}
          className={value === s.key ? 'sort active' : 'sort'}
          onClick={() => onChange(s.key)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
