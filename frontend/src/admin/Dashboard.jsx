import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { AreaChart, BarList, Donut } from '../components/Charts';

const STATUS_LABELS = { new: 'New', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };
const TYPE_LABELS = { issue: 'Issues', request: 'Requests', feedback: 'Feedback', compliment: 'Compliments' };

export default function Dashboard() {
  const [days, setDays] = useState(30);
  const [m, setM] = useState(null);
  const [error, setError] = useState('');
  const [insights, setInsights] = useState(null);
  const [insightsBusy, setInsightsBusy] = useState(false);

  useEffect(() => {
    setM(null);
    api.metrics(days).then(setM).catch(err => setError(err.message));
  }, [days]);

  async function loadInsights() {
    setInsightsBusy(true);
    setInsights(null);
    try {
      setInsights(await api.insights());
    } catch (err) {
      setInsights({ insights: [err.message] });
    } finally {
      setInsightsBusy(false);
    }
  }

  if (error) return <div className="error-note">{error}</div>;
  if (!m) return <div className="center-pad"><span className="spinner" /></div>;

  const t = m.totals;
  const fmtH = (v) => v == null ? '—' : `${v}h`;

  return (
    <>
      <div className="admin-head">
        <div>
          <div className="kicker" style={{ color: 'var(--orange)' }}>Guest Care HQ</div>
          <h1 className="display">Dashboard</h1>
          <div className="sub">What guests are telling us, and how fast we’re getting back to them.</div>
        </div>
        <div className="actions" style={{ display: 'flex', gap: 8 }}>
          {[7, 30, 90].map(d => (
            <button key={d} className={`btn btn-small ${days === d ? 'btn-teal' : 'btn-ghost'}`} onClick={() => setDays(d)}>
              {d} days
            </button>
          ))}
        </div>
      </div>

      {t.safety_open > 0 && (
        <div className="error-note" style={{ marginBottom: 16, marginTop: 0 }}>
          🚨 {t.safety_open} open safety {t.safety_open === 1 ? 'concern needs' : 'concerns need'} attention —{' '}
          <Link to="/admin/submissions?urgency=safety">review now</Link>
        </div>
      )}

      <div className="kpi-grid">
        <div className="kpi"><div className="v">{t.in_range}</div><div className="l">Submissions · {m.rangeDays}d</div></div>
        <div className={`kpi${t.open > 0 ? '' : ' good'}`}><div className="v">{t.open}</div><div className="l">Open right now</div></div>
        <div className="kpi"><div className="v">{fmtH(t.avg_first_response_h)}</div><div className="l">Avg first response</div></div>
        <div className="kpi"><div className="v">{fmtH(t.avg_resolution_h)}</div><div className="l">Avg resolution</div></div>
        {m.features.csat && (
          <div className="kpi good">
            <div className="v">{m.csat.avg ?? '—'}<small>/5</small></div>
            <div className="l">Guest rating ({m.csat.n})</div>
          </div>
        )}
        <div className="kpi good"><div className="v">{t.compliments}</div><div className="l">Compliments 💚</div></div>
      </div>

      {m.sla.enabled && (() => {
        const overdue = (m.sla.response_overdue || 0) + (m.sla.resolution_overdue || 0);
        const ok = overdue === 0;
        return (
          <div className="card sla-card" style={{
            marginBottom: 16,
            borderColor: ok ? '#CBDDA9' : '#E5CBAE',
            background: ok ? '#F2F7E6' : 'var(--orange-soft)',
          }}>
            <h3 style={{ color: ok ? 'var(--green-dark)' : '#8A4A16' }}>
              {ok ? '✓ SLA — on target' : '⏰ SLA watch'}
            </h3>
            <div className="sla-strip">
              <div className="sla-stat">
                <div className="v">{m.sla.response_met_pct ?? '—'}{m.sla.response_met_pct != null && <small>%</small>}</div>
                <div className="l">first responses within {m.sla.firstResponseHours}h · {m.rangeDays}d</div>
              </div>
              <div className="sla-stat">
                <div className="v">{m.sla.resolution_met_pct ?? '—'}{m.sla.resolution_met_pct != null && <small>%</small>}</div>
                <div className="l">resolved within {m.sla.resolutionHours}h · {m.rangeDays}d</div>
              </div>
              <div className="sla-note">
                {!ok && (
                  <p style={{ margin: '0 0 6px', fontSize: 14 }}>
                    {m.sla.response_overdue > 0 && <><strong>{m.sla.response_overdue}</strong> waiting past the first-response target. </>}
                    {m.sla.resolution_overdue > 0 && <><strong>{m.sla.resolution_overdue}</strong> open past the resolution target.</>}
                  </p>
                )}
                <p className="muted" style={{ margin: 0 }}>
                  Monitored by <strong>{m.accountability?.slaMonitor || 'Guest Care'}</strong>
                  {m.accountability?.reviewCadence ? <> · {m.accountability.reviewCadence}</> : null}
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3>Submissions over time</h3>
          <p className="hint">Daily volume, last {m.rangeDays} days</p>
          <AreaChart series={m.series} />
        </div>
        <div className="card">
          <h3>By type</h3>
          <p className="hint">Issue vs request vs praise</p>
          <Donut rows={m.byType} labelMap={TYPE_LABELS} />
        </div>
      </div>

      <div className="grid-2-even" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3>By category</h3>
          <p className="hint">Where the work is coming from</p>
          <BarList rows={m.byCategory} emojiKey="emoji" />
        </div>
        <div className="card">
          <h3>Top locations</h3>
          <p className="hint">Most-mentioned places on site</p>
          <BarList rows={m.byLocation} green />
        </div>
      </div>

      <div className="grid-2-even">
        {m.features.hotspots && (
          <div className="card">
            <h3>🔥 Hotspots</h3>
            <p className="hint">2+ issues for the same place & category in the last 7 days</p>
            {m.hotspots.length === 0
              ? <div className="muted">No repeat trouble spots this week. 👌</div>
              : m.hotspots.map((h, i) => (
                <div key={i} className="bar-row">
                  <div className="lbl" style={{ width: 'auto', flex: 1, textAlign: 'left' }}>
                    <strong>{h.location}</strong> · {h.category}
                  </div>
                  <span className="badge u-high">{h.count}× this week</span>
                </div>
              ))}
          </div>
        )}
        {m.features.aiInsights && (
          <div className="card">
            <h3>✨ AI insights</h3>
            <p className="hint">Claude reads the last 30 days and flags what matters</p>
            {insights ? (
              <ul className="insights-list">
                {insights.insights.map((line, i) => (
                  <li key={i}><span className="spark">▸</span><span>{line}</span></li>
                ))}
              </ul>
            ) : (
              <button className="btn btn-teal btn-small" onClick={loadInsights} disabled={insightsBusy}>
                {insightsBusy ? 'Reading submissions…' : 'Generate insights'}
              </button>
            )}
            {insights && !insightsBusy && (
              <button className="btn btn-ghost btn-small" style={{ marginTop: 12 }} onClick={loadInsights}>Refresh</button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
