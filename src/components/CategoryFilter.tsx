import type { Category } from '../types';
import { CATEGORIES } from '../lib/constants';

interface Props {
  value: Category | null;
  onChange: (category: Category | null) => void;
}

export function CategoryFilter({ value, onChange }: Props) {
  const options: (Category | null)[] = [null, ...CATEGORIES];
  return (
    <div className="chips" role="radiogroup" aria-label="음식 종류">
      {options.map((c) => (
        <button
          key={c ?? 'all'}
          type="button"
          role="radio"
          aria-checked={value === c}
          className={value === c ? 'chip active' : 'chip'}
          onClick={() => onChange(c)}
        >
          {c ?? '전체'}
        </button>
      ))}
    </div>
  );
}
