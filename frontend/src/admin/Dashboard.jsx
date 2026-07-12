import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { AreaChart, BarList, Donut, TrendChart } from '../components/Charts';
import { useActor } from './AdminApp';

const STATUS_LABELS = { new: 'New', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };
const TYPE_LABELS = { issue: 'Issues', request: 'Requests', feedback: 'Feedback', compliment: 'Compliments' };
const TRIAGE_LABELS = { ai: '✨ AI triage', keywords: 'Keyword match', unclassified: 'Unclassified' };

const fmtPct = (v) => v == null ? '—' : `${v}%`;
const fmtNum = (v) => v == null ? '—' : v;

export default function Dashboard() {
  const actor = useActor();
  const [days, setDays] = useState(30);
  const [dept, setDept] = useState('');
  const [departments, setDepartments] = useState([]);
  const [m, setM] = useState(null);
  const [error, setError] = useState('');
  const [insights, setInsights] = useState(null);
  const [insightsBusy, setInsightsBusy] = useState(false);

  useEffect(() => {
    api.catalog('departments').then(d => {
      const rows = d.rows.filter(r => r.active);
      setDepartments(actor.can('metrics.view_all') ? rows : rows.filter(r => actor.deptIds.includes(r.id)));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setM(null);
    api.metrics(days, dept).then(setM).catch(err => setError(err.message));
  }, [days, dept]);

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
        <div className="actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(departments.length > 1 || dept) && (
            <select className="input" style={{ width: 'auto', padding: '8px 10px' }} value={dept}
              onChange={e => setDept(e.target.value)} aria-label="Department filter">
              <option value="">{actor.can('metrics.view_all') ? 'All departments' : 'My departments'}</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
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
        {t.held_now > 0 && (
          <div className="kpi"><div className="v">⏸ {t.held_now}</div><div className="l">Held for opening hours</div></div>
        )}
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
                <div className="l">first responses within target ({m.sla.firstResponseHours}h default) · {m.rangeDays}d</div>
              </div>
              <div className="sla-stat">
                <div className="v">{m.sla.resolution_met_pct ?? '—'}{m.sla.resolution_met_pct != null && <small>%</small>}</div>
                <div className="l">resolved within target ({m.sla.resolutionHours}h default) · {m.rangeDays}d</div>
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

      {!dept && m.scorecards?.length > 1 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Department scorecards</h3>
          <p className="hint">Volume, speed (vs. each item’s own SLA clock), compliance and satisfaction — last {m.rangeDays} days</p>
          <div style={{ overflowX: 'auto' }}>
            <table className="score-table">
              <thead>
                <tr>
                  <th className="pl">Department</th>
                  <th>Vol</th><th>Open</th><th>Held</th>
                  <th>Median resp</th><th>P90 resp</th>
                  <th>Resp SLA</th><th>Reso SLA</th>
                  <th>Breaches</th><th>Rerouted in</th><th>CSAT</th>
                </tr>
              </thead>
              <tbody>
                {m.scorecards.map(sc => {
                  const respPct = sc.response_due_n > 0 ? Math.round((sc.response_met / sc.response_due_n) * 100) : null;
                  const resoPct = sc.resolution_due_n > 0 ? Math.round((sc.resolution_met / sc.resolution_due_n) * 100) : null;
                  const breaches = (sc.response_breaches || 0) + (sc.resolution_breaches || 0);
                  return (
                    <tr key={sc.id}>
                      <td className="pl"><strong>{sc.name}</strong>{sc.has_hours ? '' : <span className="muted" title="No hours set"> · 24/7</span>}</td>
                      <td>{sc.volume}</td>
                      <td>{sc.open}</td>
                      <td>{sc.held > 0 ? `⏸ ${sc.held}` : '—'}</td>
                      <td>{sc.median_response_h != null ? `${sc.median_response_h}h` : '—'}</td>
                      <td>{sc.p90_response_h != null ? `${sc.p90_response_h}h` : '—'}</td>
                      <td className={respPct != null && respPct < 80 ? 'bad' : ''}>{fmtPct(respPct)}</td>
                      <td className={resoPct != null && resoPct < 80 ? 'bad' : ''}>{fmtPct(resoPct)}</td>
                      <td className={breaches > 0 ? 'bad' : ''}>{fmtNum(breaches)}</td>
                      <td>{fmtNum(sc.rerouted_in)}</td>
                      <td>{sc.csat != null ? `${sc.csat}★ (${sc.csat_n})` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

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

      {m.sla.enabled && (
        <div className="grid-2" style={{ marginBottom: 16 }}>
          <div className="card">
            <h3>SLA compliance trend</h3>
            <p className="hint">Weekly share of submissions handled inside their target</p>
            <TrendChart rows={m.trend} />
          </div>
          <div className="card">
            <h3>Triage source</h3>
            <p className="hint">Who sorted the incoming notes{t.rerouted > 0 ? ` · ${t.rerouted} rerouted after hours` : ''}</p>
            <Donut rows={m.byTriage} labelMap={TRIAGE_LABELS} />
          </div>
        </div>
      )}

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
