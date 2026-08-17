import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { AreaChart, BarList, Donut } from '../components/Charts';
import { useActor } from './AdminApp';

// Everything here is computed from the synced RAP board cache: statuses,
// categories, departments and severities exactly as RAP grades them, plus the
// guest-surface extras only WoodsVoice knows (visits, CSAT ratings).

const STATUS_LABELS = { open: 'New', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };
const SEVERITY_LABELS = { 1: 'Sev 1 · minor', 2: 'Sev 2', 3: 'Sev 3', 4: 'Sev 4 · high', 5: 'Sev 5 · urgent' };
const MOOD_LABELS = { 1: '😊 Delighted', 2: '🙂 Content', 3: '😐 Neutral', 4: '😠 Upset', 5: '😡 Extremely upset' };
const VISIT_SOURCE_LABELS = { qr: '📱 QR scan', kiosk: '🖥️ Kiosk', web: '🌐 Direct / typed link' };

const pretty = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

export default function Dashboard() {
  const actor = useActor();
  const [days, setDays] = useState(30);
  const [dept, setDept] = useState('');
  const [deptOptions, setDeptOptions] = useState([]);
  const [m, setM] = useState(null);
  const [error, setError] = useState('');
  const [insights, setInsights] = useState(null);
  const [insightsBusy, setInsightsBusy] = useState(false);

  useEffect(() => {
    // The department picker speaks RAP's own labels, learned from the data.
    api.submissionStats().then(d => setDeptOptions(d.facets?.departments || [])).catch(() => {});
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
  const statusRows = (m.byStatus || []).map(r => ({ ...r, label: r.label }));

  return (
    <>
      <div className="admin-head">
        <div>
          <div className="kicker" style={{ color: 'var(--orange)' }}>Guest Care HQ</div>
          <h1 className="display">Dashboard</h1>
          <div className="sub">What guests are telling us — live from the RAP board.</div>
        </div>
        <div className="actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(deptOptions.length > 1 || dept) && (
            <select className="input" style={{ width: 'auto', padding: '8px 10px' }} value={dept}
              onChange={e => setDept(e.target.value)} aria-label="Department filter">
              <option value="">All departments</option>
              {deptOptions.map(d => <option key={d} value={d}>{pretty(d)}</option>)}
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
          🚨 {t.safety_open} open severity-5 {t.safety_open === 1 ? 'concern needs' : 'concerns need'} attention —{' '}
          <Link to="/admin/submissions?severity=5">review now</Link>
        </div>
      )}

      <div className="kpi-grid">
        <div className="kpi"><div className="v">{t.in_range}</div><div className="l">Tickets · {m.rangeDays}d</div></div>
        <div className={`kpi${t.open > 0 ? '' : ' good'}`}><div className="v">{t.open}</div><div className="l">Open right now</div></div>
        <div className="kpi"><div className="v">{t.from_woodsvoice}</div><div className="l">Submitted here · {m.rangeDays}d</div></div>
        <div className="kpi"><div className="v">{fmtH(t.avg_first_response_h)}</div><div className="l">Avg first action</div></div>
        <div className="kpi"><div className="v">{fmtH(t.avg_resolution_h)}</div><div className="l">Avg resolution</div></div>
        {m.features.csat && (
          <div className="kpi good">
            <div className="v">{m.csat.avg ?? '—'}<small>/5</small></div>
            <div className="l">Guest rating ({m.csat.n})</div>
          </div>
        )}
      </div>

      {!dept && m.byDepartment?.length > 1 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Departments on the board</h3>
          <p className="hint">RAP’s own routing — volume, open load, and how fast things resolve · last {m.rangeDays} days</p>
          <div style={{ overflowX: 'auto' }}>
            <table className="score-table">
              <thead>
                <tr>
                  <th className="pl">Department</th>
                  <th>Vol</th><th>Open</th><th>Median resolution</th>
                </tr>
              </thead>
              <tbody>
                {m.byDepartment.map(sc => (
                  <tr key={sc.label}>
                    <td className="pl"><strong>{pretty(sc.label)}</strong></td>
                    <td>{sc.volume}</td>
                    <td>{sc.open}</td>
                    <td>{sc.median_resolution_h != null ? `${sc.median_resolution_h}h` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3>Tickets over time</h3>
          <p className="hint">Daily volume, last {m.rangeDays} days</p>
          <AreaChart series={m.series} />
        </div>
        <div className="card">
          <h3>By status</h3>
          <p className="hint">Where the board stands</p>
          <Donut rows={statusRows} labelMap={STATUS_LABELS} />
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3>Severity</h3>
          <p className="hint">RAP’s triage grades (1 minor → 5 urgent)</p>
          <Donut rows={m.bySeverity} labelMap={SEVERITY_LABELS} />
        </div>
        <div className="card">
          <h3>Guest mood</h3>
          <p className="hint">How guests sounded when they wrote in</p>
          <Donut rows={m.byMood} labelMap={MOOD_LABELS} />
        </div>
      </div>

      {m.visits?.enabled && (() => {
        const v = m.visits;
        const sourceRows = ['qr', 'kiosk', 'web']
          .map(s => ({ label: s, count: v[s] || 0 }))
          .filter(r => r.count > 0);
        const qrShare = v.total > 0 ? Math.round(((v.qr || 0) / v.total) * 100) : null;
        const neverScanned = v.byLocation.filter(l => l.visits === 0).length;
        return (
          <>
            <div className="grid-2" style={{ marginBottom: 16 }}>
              <div className="card">
                <h3>Guest visits</h3>
                <p className="hint">
                  Form opens, last {m.rangeDays} days — <strong>{v.total || 0}</strong> visits
                  from ~<strong>{v.unique_visitors || 0}</strong> devices
                  {qrShare != null ? <> · {qrShare}% arrived by QR scan</> : null}
                </p>
                <AreaChart series={v.series} />
              </div>
              <div className="card">
                <h3>How guests arrive</h3>
                <p className="hint">Scanned a cabin card, walked up to a kiosk, or typed the link</p>
                <Donut rows={sourceRows} labelMap={VISIT_SOURCE_LABELS} />
              </div>
            </div>

            {!dept && (
              <div className="card" style={{ marginBottom: 16 }}>
                <h3>QR scans by location</h3>
                <p className="hint">
                  Every posted card: is it getting scanned, and do scans turn into notes?
                  {neverScanned > 0 && <> <strong>{neverScanned}</strong> location{neverScanned === 1 ? ' has' : 's have'} no visits this period — those cards may be missing, damaged, or just not noticed.</>}
                  {v.byLocation.some(l => l.submissions > l.visits) &&
                    <> One visit can produce several notes (and notes sent before visit tracking was switched on still count), so conversion can top 100%.</>}
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table className="score-table">
                    <thead>
                      <tr>
                        <th className="pl">Location</th>
                        <th>Area</th>
                        <th>Visits</th>
                        <th>Via QR</th>
                        <th>Notes sent</th>
                        <th>Visit → note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {v.byLocation.map(l => {
                        const conv = l.visits > 0 ? Math.round((l.submissions / l.visits) * 100) : null;
                        return (
                          <tr key={l.id} style={l.visits === 0 ? { opacity: 0.55 } : undefined}>
                            <td className="pl"><strong>{l.name}</strong>{l.active ? '' : <span className="muted"> · deactivated</span>}</td>
                            <td>{l.area}</td>
                            <td>{l.visits === 0 ? <span className="badge u-high">no scans yet</span> : l.visits}</td>
                            <td>{l.visits === 0 ? '—' : l.qr_visits}</td>
                            <td>{l.submissions}</td>
                            <td>{conv == null ? '—' : `${conv}%`}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        );
      })()}

      <div className="grid-2-even" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3>By category</h3>
          <p className="hint">RAP’s categories — where the work is coming from</p>
          <BarList rows={(m.byCategory || []).map(r => ({ ...r, label: pretty(r.label) }))} />
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
            <p className="hint">2+ tickets for the same place & category in the last 7 days</p>
            {m.hotspots.length === 0
              ? <div className="muted">No repeat trouble spots this week. 👌</div>
              : m.hotspots.map((h, i) => (
                <div key={i} className="bar-row">
                  <div className="lbl" style={{ width: 'auto', flex: 1, textAlign: 'left' }}>
                    <strong>{h.location}</strong> · {pretty(h.category)}
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
                {insightsBusy ? 'Reading tickets…' : 'Generate insights'}
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
