import React from 'react';

// Hand-rolled, dependency-free charts in brand colours.

export function AreaChart({ series, height = 170 }) {
  if (!series?.length) return <div className="muted">No data yet.</div>;
  const w = 640;
  const h = height;
  const padX = 6;
  const padY = 18;
  const max = Math.max(...series.map(d => d.count), 4);
  const stepX = (w - padX * 2) / Math.max(series.length - 1, 1);
  const pts = series.map((d, i) => [
    padX + i * stepX,
    h - padY - (d.count / max) * (h - padY * 2),
  ]);

  // Smooth-ish path via simple midpoint curves
  let line = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2;
    line += ` C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`;
  }
  const area = `${line} L ${pts[pts.length - 1][0]} ${h - 4} L ${pts[0][0]} ${h - 4} Z`;

  const gridY = [0.25, 0.5, 0.75].map(f => h - padY - f * (h - padY * 2));
  const first = series[0]?.day?.slice(5);
  const last = series[series.length - 1]?.day?.slice(5);

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" role="img" aria-label="Submissions over time">
        <defs>
          <linearGradient id="wvArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#A3CD42" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#A3CD42" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        {gridY.map((y, i) => (
          <line key={i} x1={padX} x2={w - padX} y1={y} y2={y} stroke="#E2DDD2" strokeDasharray="3 5" />
        ))}
        <path d={area} fill="url(#wvArea)" />
        <path d={line} fill="none" stroke="#1E5A64" strokeWidth="2.5" strokeLinecap="round" />
        {pts.length <= 35 && pts.map(([x, y], i) => (
          series[i].count > 0 ? <circle key={i} cx={x} cy={y} r="3" fill="#1E5A64" /> : null
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between' }} className="chart-tip">
        <span>{first}</span>
        <span>peak {max}/day</span>
        <span>{last}</span>
      </div>
    </div>
  );
}

export function BarList({ rows, green, labelKey = 'label', emojiKey }) {
  if (!rows?.length) return <div className="muted">No data yet.</div>;
  const max = Math.max(...rows.map(r => r.count), 1);
  return (
    <div>
      {rows.map((r, i) => (
        <div className={`bar-row${green ? ' green' : ''}`} key={i}>
          <div className="lbl">{emojiKey && r[emojiKey] ? `${r[emojiKey]} ` : ''}{r[labelKey]}</div>
          <div className="track"><div className="fill" style={{ width: `${(r.count / max) * 100}%` }} /></div>
          <div className="n">{r.count}</div>
        </div>
      ))}
    </div>
  );
}

const DONUT_COLOURS = ['#1E5A64', '#A3CD42', '#C26628', '#1087A3', '#1F6331', '#8E867A'];

export function Donut({ rows, size = 150, labelMap = {} }) {
  if (!rows?.length) return <div className="muted">No data yet.</div>;
  const total = rows.reduce((n, r) => n + r.count, 0) || 1;
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox="0 0 110 110" role="img" aria-label="Breakdown">
        <circle cx="55" cy="55" r={r} fill="none" stroke="#EFEAE0" strokeWidth="15" />
        {rows.map((row, i) => {
          const frac = row.count / total;
          const dash = `${frac * c} ${c}`;
          const el = (
            <circle
              key={i}
              cx="55" cy="55" r={r}
              fill="none"
              stroke={DONUT_COLOURS[i % DONUT_COLOURS.length]}
              strokeWidth="15"
              strokeDasharray={dash}
              strokeDashoffset={-offset * c}
              transform="rotate(-90 55 55)"
            />
          );
          offset += frac;
          return el;
        })}
        <text x="55" y="52" textAnchor="middle" fontFamily="League Gothic" fontSize="26" fill="#1B4849">{total}</text>
        <text x="55" y="68" textAnchor="middle" fontFamily="Montserrat" fontWeight="700" fontSize="7" letterSpacing="1.5" fill="#7D8E92">TOTAL</text>
      </svg>
      <div style={{ flex: 1, minWidth: 130 }}>
        {rows.map((row, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '3px 0' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: DONUT_COLOURS[i % DONUT_COLOURS.length], flexShrink: 0 }} />
            <span style={{ flex: 1, color: 'var(--ink-soft)', fontWeight: 600 }}>{labelMap[row.label] || row.label}</span>
            <strong style={{ fontFamily: 'Montserrat' }}>{row.count}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
