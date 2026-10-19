import type { Mode } from '../types';
import { MODES } from '../lib/constants';

interface Props {
  value: Mode;
  onChange: (mode: Mode) => void;
}

export function ModeTabs({ value, onChange }: Props) {
  return (
    <nav className="mode-tabs" role="tablist" aria-label="식사 방식">
      {MODES.map((m) => (
        <button
          key={m.key}
          type="button"
          role="tab"
          aria-selected={value === m.key}
          className={value === m.key ? 'mode-tab active' : 'mode-tab'}
          onClick={() => onChange(m.key)}
        >
          <span aria-hidden="true">{m.emoji}</span> {m.label}
        </button>
      ))}
    </nav>
  );
}
