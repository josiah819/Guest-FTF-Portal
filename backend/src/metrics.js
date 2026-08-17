const { pool, getSettings } = require('./db');

// All dashboard numbers in one query batch, computed over the RAP board cache
// (rap_tickets) joined to the local capture ledger (rap_queue — capture times,
// CSAT ratings, source channels). `days` bounds the range (7/30/90).
//
// Time bases:
//  - created: our capture time when the ticket originated here, else RAP's
//    created_at, else when the sync first saw it.
//  - responded: when the sync first saw the ticket leave 'open' — an
//    observation timestamp, honest to ±1 poll tick.
//  - resolved: RAP's resolved_at when the export carries one, else observed.
//
// `department` filters on RAP's own department label (the dashboard's picker
// is fed from the facets endpoint).

// One normalized view over cache+ledger, shared by every panel query.
const T = `
  SELECT rt.id, rt.status, rt.department, rt.category, rt.severity, rt.mood,
         rt.building, q.location_name, q.rating, q.source,
         (q.id IS NOT NULL) AS ours,
         coalesce(q.created_at, rt.rap_created_at, rt.first_seen_at) AS created,
         rt.observed_response_at AS responded,
         coalesce(rt.rap_resolved_at, rt.observed_resolved_at) AS resolved
    FROM rap_tickets rt
    LEFT JOIN rap_queue q ON q.rap_ticket_id = rt.id`;

async function dashboardMetrics(days = 30, { department = null } = {}) {
  const range = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365);
  const settings = await getSettings();

  // Replaces __SCOPE__ with an AND predicate on the RAP department label.
  const q = (sql, params = []) => {
    if (!department) return pool.query(`WITH t AS (${T}) ${sql.replace(/__SCOPE__/g, '')}`, params);
    const idx = params.length + 1;
    return pool.query(
      `WITH t AS (${T}) ${sql.replace(/__SCOPE__/g, ` AND t.department = $${idx}`)}`,
      [...params, department]);
  };

  const p = [range];

  // Guest-surface traffic. Visits have no board dimension, so this block is
  // site-wide for anyone who can open the dashboard — it holds page-open
  // counts only, never submission content.
  const visitsOn = settings.features.visitTracking !== false;

  const [totals, series, byCategory, byDepartment, byStatus, bySeverity, byMood, byLocation, csat, hotspots,
         visitTotals, visitSeries, visitsByLocation] =
    await Promise.all([
      q(`SELECT
           count(*) FILTER (WHERE t.created > now() - make_interval(days => $1))::int AS in_range,
           count(*) FILTER (WHERE t.status IN ('open','in_progress'))::int AS open,
           count(*) FILTER (WHERE t.status = 'open')::int AS unread,
           count(*) FILTER (WHERE t.severity = 5 AND t.status IN ('open','in_progress'))::int AS safety_open,
           count(*) FILTER (WHERE t.ours AND t.created > now() - make_interval(days => $1))::int AS from_woodsvoice,
           round(avg(EXTRACT(EPOCH FROM (t.responded - t.created)) / 3600.0)
             FILTER (WHERE t.responded IS NOT NULL AND t.created > now() - make_interval(days => $1))::numeric, 1) AS avg_first_response_h,
           round(avg(EXTRACT(EPOCH FROM (t.resolved - t.created)) / 3600.0)
             FILTER (WHERE t.resolved IS NOT NULL AND t.created > now() - make_interval(days => $1))::numeric, 1) AS avg_resolution_h
         FROM t WHERE true __SCOPE__`, p),
      q(`SELECT to_char(d.day, 'YYYY-MM-DD') AS day, coalesce(n.count, 0)::int AS count
           FROM generate_series(date_trunc('day', now()) - make_interval(days => $1 - 1),
                                date_trunc('day', now()), '1 day') AS d(day)
           LEFT JOIN (
             SELECT date_trunc('day', t.created) AS day, count(*) AS count
               FROM t
              WHERE t.created > date_trunc('day', now()) - make_interval(days => $1 - 1) __SCOPE__
              GROUP BY 1) n ON n.day = d.day
          ORDER BY d.day`, p),
      q(`SELECT coalesce(nullif(t.category, ''), 'uncategorized') AS label, count(*)::int AS count
           FROM t
          WHERE t.created > now() - make_interval(days => $1) __SCOPE__
          GROUP BY 1 ORDER BY count DESC`, p),
      // Per-department scorecard, RAP labels verbatim: volume, open load, and
      // how fast things get resolved.
      q(`SELECT coalesce(nullif(t.department, ''), 'unrouted') AS label,
                count(*) FILTER (WHERE t.created > now() - make_interval(days => $1))::int AS volume,
                count(*) FILTER (WHERE t.status IN ('open','in_progress'))::int AS open,
                round((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.resolved - t.created)) / 3600.0)
                  FILTER (WHERE t.resolved IS NOT NULL AND t.created > now() - make_interval(days => $1)))::numeric, 1) AS median_resolution_h
           FROM t WHERE true __SCOPE__
          GROUP BY 1 ORDER BY volume DESC`, p),
      q(`SELECT t.status AS label, count(*)::int AS count FROM t
          WHERE t.created > now() - make_interval(days => $1) __SCOPE__ GROUP BY 1`, p),
      q(`SELECT t.severity AS label, count(*)::int AS count FROM t
          WHERE t.severity IS NOT NULL AND t.created > now() - make_interval(days => $1) __SCOPE__
          GROUP BY 1 ORDER BY 1`, p),
      q(`SELECT t.mood AS label, count(*)::int AS count FROM t
          WHERE t.mood IS NOT NULL AND t.created > now() - make_interval(days => $1) __SCOPE__
          GROUP BY 1 ORDER BY 1`, p),
      q(`SELECT coalesce(nullif(t.building, ''), nullif(t.location_name, ''), 'Unknown') AS label, count(*)::int AS count
           FROM t
          WHERE t.created > now() - make_interval(days => $1) __SCOPE__
          GROUP BY 1 ORDER BY count DESC LIMIT 8`, p),
      q(`SELECT round(avg(t.rating)::numeric, 1) AS avg, count(t.rating)::int AS n
           FROM t WHERE t.rating IS NOT NULL AND t.created > now() - make_interval(days => $1) __SCOPE__`, p),
      settings.features.hotspots ? q(
        `SELECT coalesce(nullif(t.building, ''), nullif(t.location_name, ''), 'Unknown') AS location,
                coalesce(nullif(t.category, ''), 'uncategorized') AS category, count(*)::int AS count
           FROM t
          WHERE t.created > now() - interval '7 days' __SCOPE__
          GROUP BY 1, 2 HAVING count(*) >= 2
          ORDER BY count DESC LIMIT 5`, []) : Promise.resolve({ rows: [] }),
      visitsOn ? pool.query(
        `SELECT count(*)::int AS total,
                count(DISTINCT visitor_key)::int AS unique_visitors,
                count(*) FILTER (WHERE source = 'qr')::int AS qr,
                count(*) FILTER (WHERE source = 'kiosk')::int AS kiosk,
                count(*) FILTER (WHERE source = 'web')::int AS web
           FROM visits WHERE created_at > now() - make_interval(days => $1)`, p) : Promise.resolve({ rows: [{}] }),
      visitsOn ? pool.query(
        `SELECT to_char(d.day, 'YYYY-MM-DD') AS day, coalesce(n.count, 0)::int AS count
           FROM generate_series(date_trunc('day', now()) - make_interval(days => $1 - 1),
                                date_trunc('day', now()), '1 day') AS d(day)
           LEFT JOIN (
             SELECT date_trunc('day', created_at) AS day, count(*) AS count
               FROM visits
              WHERE created_at > date_trunc('day', now()) - make_interval(days => $1 - 1)
              GROUP BY 1) n ON n.day = d.day
          ORDER BY d.day`, p) : Promise.resolve({ rows: [] }),
      // Every active location — zero-visit rows are the point (a QR card
      // nobody scans may be missing or damaged). Inactive ones only appear
      // while they still draw traffic. Submissions counted from the capture
      // ledger by the location name stamped at capture.
      visitsOn ? pool.query(
        `SELECT l.id, l.name, l.area, l.active,
                coalesce(v.visits, 0)::int AS visits,
                coalesce(v.qr_visits, 0)::int AS qr_visits,
                coalesce(s.submissions, 0)::int AS submissions
           FROM locations l
           LEFT JOIN (SELECT location_id, count(*) AS visits,
                             count(*) FILTER (WHERE source = 'qr') AS qr_visits
                        FROM visits WHERE created_at > now() - make_interval(days => $1)
                       GROUP BY 1) v ON v.location_id = l.id
           LEFT JOIN (SELECT location_name, count(*) AS submissions
                        FROM rap_queue WHERE created_at > now() - make_interval(days => $1)
                       GROUP BY 1) s ON s.location_name = l.name
          WHERE l.active OR coalesce(v.visits, 0) > 0
          ORDER BY visits DESC, l.area, l.sort, l.name`, p) : Promise.resolve({ rows: [] }),
    ]);

  return {
    rangeDays: range,
    department,
    totals: totals.rows[0],
    csat: csat.rows[0],
    series: series.rows,
    byCategory: byCategory.rows,
    byDepartment: byDepartment.rows,
    byStatus: byStatus.rows,
    bySeverity: bySeverity.rows,
    byMood: byMood.rows,
    byLocation: byLocation.rows,
    hotspots: hotspots.rows,
    visits: {
      enabled: visitsOn,
      ...visitTotals.rows[0],
      series: visitSeries.rows,
      byLocation: visitsByLocation.rows,
    },
    features: { hotspots: settings.features.hotspots, aiInsights: settings.features.aiInsights, csat: settings.features.csat },
  };
}

// Compact stats + recent raw ticket texts for the AI insights prompt
// (board-wide; the insights.run permission gates access).
async function insightsInput() {
  const m = await dashboardMetrics(30);
  const { rows: recent } = await pool.query(
    `WITH t AS (${T}) SELECT t.status, t.severity, t.category, t.department,
            coalesce(nullif(t.building, ''), t.location_name) AS location,
            left(coalesce(nullif(rt2.text, ''), rt2.summary), 500) AS message
       FROM t JOIN rap_tickets rt2 ON rt2.id = t.id
      ORDER BY t.created DESC LIMIT 40`);
  const stats = {
    totals: m.totals, csat: m.csat, byCategory: m.byCategory,
    byDepartment: m.byDepartment, bySeverity: m.bySeverity, byMood: m.byMood,
    hotspots: m.hotspots,
  };
  return { stats, recent };
}

module.exports = { dashboardMetrics, insightsInput };
