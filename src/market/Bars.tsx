/** 가벼운 가로 막대그래프 (차트 라이브러리 없이). 값이 없으면 막대를 그리지 않는다 */
export interface BarItem {
  key: string;
  label: string;
  value: number;
  /** 막대 오른쪽에 쓰는 값 */
  display: string;
  /** 막대 아래 작은 글씨 */
  sub?: string;
  highlight?: boolean;
}

export function Bars({ items, label }: { items: BarItem[]; label: string }) {
  const max = Math.max(0, ...items.map((i) => i.value));
  return (
    <ul className="mk-bars" aria-label={label}>
      {items.map((i) => (
        <li key={i.key} className={i.highlight ? 'mk-bar hl' : 'mk-bar'} aria-label={`${i.label} ${i.display}`}>
          <span className="mk-bar-label">{i.label}</span>
          <span className="mk-bar-track" aria-hidden="true">
            <span className="mk-bar-fill" style={{ width: max > 0 ? `${(i.value / max) * 100}%` : 0 }} />
          </span>
          <span className="mk-bar-value">{i.display}</span>
          {i.sub && <span className="mk-bar-sub">{i.sub}</span>}
        </li>
      ))}
    </ul>
  );
}

/** 홀·배달·포장 구성 막대 (한 줄) */
export function StackBar({ parts, label }: { parts: { key: string; label: string; value: number; className: string }[]; label: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total === 0) return null;
  return (
    <div className="mk-stack" role="img" aria-label={label}>
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <span key={p.key} className={`mk-stack-part ${p.className}`} style={{ width: `${(p.value / total) * 100}%` }}>
            {p.value / total >= 0.12 ? `${p.label} ${Math.round((p.value / total) * 100)}%` : ''}
          </span>
        ))}
    </div>
  );
}
