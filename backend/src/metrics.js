const { pool, getSettings } = require('./db');

// All dashboard numbers in one query batch. `days` bounds the range (7/30/90).
//
// Scoping: pass the acting user and every submissions predicate gains
// `department_id = ANY(deptIds)` unless they hold metrics.view_all. An
// explicit `department` filter narrows further (and must be inside scope).
// SLA math is due-at based: due dates were computed at routing time from the
// department/urgency/global target chain, with clocks deferred while held —
// so a held-not-yet-due item counts neither for nor against compliance.

async function dashboardMetrics(days = 30, { actor = null, department = null } = {}) {
  const range = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365);
  const settings = await getSettings();

  // null = unscoped; [] = scoped to nothing (still valid SQL, returns zeros).
  let allowed = null;
  if (actor && !actor.perms.has('metrics.view_all')) allowed = actor.deptIds || [];
  const deptId = department ? parseInt(department, 10) : null;
  if (deptId) {
    allowed = (allowed === null || allowed.includes(deptId)) ? [deptId] : [];
  }

  // Replaces __SCOPE__ with an AND predicate on s.department_id when scoped.
  const q = (sql, params = []) => {
    if (allowed === null) return pool.query(sql.replace(/__SCOPE__/g, ''), params);
    const idx = params.length + 1;
    return pool.query(sql.replace(/__SCOPE__/g, ` AND s.department_id = ANY($${idx})`), [...params, allowed]);
  };

  const p = [range];

  // Scorecards scope on d.id (the department itself), not s.department_id.
  const scorecardsPromise = pool.query(
    `SELECT d.id, d.name, d.hours IS NOT NULL AS has_hours,
            count(s.id) FILTER (WHERE s.created_at > now() - make_interval(days => $1))::int AS volume,
            count(s.id) FILTER (WHERE s.status IN ('new','in_progress'))::int AS open,
            count(s.id) FILTER (WHERE s.held_until IS NOT NULL)::int AS held,
            round((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (s.first_response_at - coalesce(s.sla_start_at, s.created_at))) / 3600.0)
              FILTER (WHERE s.first_response_at IS NOT NULL AND s.created_at > now() - make_interval(days => $1)))::numeric, 1) AS median_response_h,
            round((percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (s.first_response_at - coalesce(s.sla_start_at, s.created_at))) / 3600.0)
              FILTER (WHERE s.first_response_at IS NOT NULL AND s.created_at > now() - make_interval(days => $1)))::numeric, 1) AS p90_response_h,
            round((percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (s.resolved_at - coalesce(s.sla_start_at, s.created_at))) / 3600.0)
              FILTER (WHERE s.resolved_at IS NOT NULL AND s.created_at > now() - make_interval(days => $1)))::numeric, 1) AS median_resolution_h,
            round((percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (s.resolved_at - coalesce(s.sla_start_at, s.created_at))) / 3600.0)
              FILTER (WHERE s.resolved_at IS NOT NULL AND s.created_at > now() - make_interval(days => $1)))::numeric, 1) AS p90_resolution_h,
            count(s.id) FILTER (WHERE s.created_at > now() - make_interval(days => $1)
              AND s.first_response_due_at IS NOT NULL
              AND (s.first_response_at IS NOT NULL OR (s.held_until IS NULL AND now() > s.first_response_due_at)))::int AS response_due_n,
            count(s.id) FILTER (WHERE s.created_at > now() - make_interval(days => $1)
              AND s.first_response_at IS NOT NULL AND s.first_response_due_at IS NOT NULL
              AND s.first_response_at <= s.first_response_due_at)::int AS response_met,
            count(s.id) FILTER (WHERE s.created_at > now() - make_interval(days => $1)
              AND s.resolution_due_at IS NOT NULL
              AND (s.resolved_at IS NOT NULL OR (s.held_until IS NULL AND s.status IN ('new','in_progress') AND now() > s.resolution_due_at)))::int AS resolution_due_n,
            count(s.id) FILTER (WHERE s.created_at > now() - make_interval(days => $1)
              AND s.resolved_at IS NOT NULL AND s.resolution_due_at IS NOT NULL
              AND s.resolved_at <= s.resolution_due_at)::int AS resolution_met,
            count(s.id) FILTER (WHERE s.created_at > now() - make_interval(days => $1)
              AND s.response_breached_at IS NOT NULL)::int AS response_breaches,
            count(s.id) FILTER (WHERE s.created_at > now() - make_interval(days => $1)
              AND s.resolution_breached_at IS NOT NULL)::int AS resolution_breaches,
            count(s.id) FILTER (WHERE s.created_at > now() - make_interval(days => $1)
              AND s.rerouted_from_department_id IS NOT NULL)::int AS rerouted_in,
            round(avg(s.rating) FILTER (WHERE s.created_at > now() - make_interval(days => $1))::numeric, 1) AS csat,
            count(s.rating) FILTER (WHERE s.created_at > now() - make_interval(days => $1))::int AS csat_n
       FROM departments d
       LEFT JOIN submissions s ON s.department_id = d.id
      WHERE d.active${allowed === null ? '' : ' AND d.id = ANY($2)'}
      GROUP BY d.id
      ORDER BY d.sort, d.name`,
    allowed === null ? p : [...p, allowed]);

  const [totals, series, byCategory, byLocation, byStatus, byType, byUrgency, byTriage, csat, hotspots, slaRowQ, scorecards, trend] =
    await Promise.all([
      q(`SELECT
           count(*) FILTER (WHERE s.created_at > now() - make_interval(days => $1))::int AS in_range,
           count(*) FILTER (WHERE s.status IN ('new','in_progress'))::int AS open,
           count(*) FILTER (WHERE s.status = 'new')::int AS unread,
           count(*) FILTER (WHERE s.urgency = 'safety' AND s.status IN ('new','in_progress'))::int AS safety_open,
           count(*) FILTER (WHERE s.held_until IS NOT NULL)::int AS held_now,
           count(*) FILTER (WHERE s.rerouted_from_department_id IS NOT NULL
             AND s.created_at > now() - make_interval(days => $1))::int AS rerouted,
           count(*) FILTER (WHERE s.type = 'compliment' AND s.created_at > now() - make_interval(days => $1))::int AS compliments,
           round(avg(EXTRACT(EPOCH FROM (s.first_response_at - coalesce(s.sla_start_at, s.created_at))) / 3600.0)
             FILTER (WHERE s.first_response_at IS NOT NULL AND s.created_at > now() - make_interval(days => $1))::numeric, 1) AS avg_first_response_h,
           round(avg(EXTRACT(EPOCH FROM (s.resolved_at - coalesce(s.sla_start_at, s.created_at))) / 3600.0)
             FILTER (WHERE s.resolved_at IS NOT NULL AND s.created_at > now() - make_interval(days => $1))::numeric, 1) AS avg_resolution_h
         FROM submissions s WHERE true __SCOPE__`, p),
      q(`SELECT to_char(d.day, 'YYYY-MM-DD') AS day, coalesce(n.count, 0)::int AS count
           FROM generate_series(date_trunc('day', now()) - make_interval(days => $1 - 1),
                                date_trunc('day', now()), '1 day') AS d(day)
           LEFT JOIN (
             SELECT date_trunc('day', s.created_at) AS day, count(*) AS count
               FROM submissions s
              WHERE s.created_at > date_trunc('day', now()) - make_interval(days => $1 - 1) __SCOPE__
              GROUP BY 1) n ON n.day = d.day
          ORDER BY d.day`, p),
      q(`SELECT coalesce(c.name, 'Uncategorized') AS label, coalesce(c.emoji,'❔') AS emoji, count(*)::int AS count
           FROM submissions s LEFT JOIN categories c ON c.id = s.category_id
          WHERE s.created_at > now() - make_interval(days => $1) __SCOPE__
          GROUP BY 1, 2 ORDER BY count DESC`, p),
      q(`SELECT coalesce(l.name, nullif(s.location_text,''), 'Unknown') AS label, count(*)::int AS count
           FROM submissions s LEFT JOIN locations l ON l.id = s.location_id
          WHERE s.created_at > now() - make_interval(days => $1) __SCOPE__
          GROUP BY 1 ORDER BY count DESC LIMIT 8`, p),
      q(`SELECT s.status AS label, count(*)::int AS count FROM submissions s
          WHERE s.created_at > now() - make_interval(days => $1) __SCOPE__ GROUP BY 1`, p),
      q(`SELECT s.type AS label, count(*)::int AS count FROM submissions s
          WHERE s.created_at > now() - make_interval(days => $1) __SCOPE__ GROUP BY 1 ORDER BY count DESC`, p),
      q(`SELECT s.urgency AS label, count(*)::int AS count FROM submissions s
          WHERE s.created_at > now() - make_interval(days => $1) __SCOPE__ GROUP BY 1`, p),
      q(`SELECT CASE WHEN s.triage_via = '' THEN 'unclassified' ELSE s.triage_via END AS label, count(*)::int AS count
           FROM submissions s
          WHERE s.created_at > now() - make_interval(days => $1) __SCOPE__ GROUP BY 1 ORDER BY count DESC`, p),
      q(`SELECT round(avg(s.rating)::numeric, 1) AS avg, count(s.rating)::int AS n
           FROM submissions s WHERE s.rating IS NOT NULL AND s.created_at > now() - make_interval(days => $1) __SCOPE__`, p),
      settings.features.hotspots ? q(
        `SELECT coalesce(l.name, nullif(s.location_text,''), 'Unknown') AS location,
                coalesce(c.name, 'Uncategorized') AS category, count(*)::int AS count
           FROM submissions s
           LEFT JOIN locations l ON l.id = s.location_id
           LEFT JOIN categories c ON c.id = s.category_id
          WHERE s.created_at > now() - interval '7 days' AND s.type IN ('issue','request') __SCOPE__
          GROUP BY 1, 2 HAVING count(*) >= 2
          ORDER BY count DESC LIMIT 5`, []) : Promise.resolve({ rows: [] }),
      settings.features.sla ? q(
        `SELECT
           count(*) FILTER (WHERE s.first_response_at IS NULL AND s.status IN ('new','in_progress')
             AND s.held_until IS NULL AND s.first_response_due_at IS NOT NULL
             AND now() > s.first_response_due_at)::int AS response_overdue,
           count(*) FILTER (WHERE s.resolved_at IS NULL AND s.status IN ('new','in_progress')
             AND s.held_until IS NULL AND s.resolution_due_at IS NOT NULL
             AND now() > s.resolution_due_at)::int AS resolution_overdue,
           count(*) FILTER (WHERE s.created_at > now() - make_interval(days => $1)
             AND s.first_response_due_at IS NOT NULL
             AND (s.first_response_at IS NOT NULL OR (s.held_until IS NULL AND now() > s.first_response_due_at)))::int AS response_due_n,
           count(*) FILTER (WHERE s.created_at > now() - make_interval(days => $1)
             AND s.first_response_at IS NOT NULL AND s.first_response_due_at IS NOT NULL
             AND s.first_response_at <= s.first_response_due_at)::int AS response_met,
           count(*) FILTER (WHERE s.created_at > now() - make_interval(days => $1)
             AND s.resolution_due_at IS NOT NULL
             AND (s.resolved_at IS NOT NULL OR (s.held_until IS NULL AND s.status IN ('new','in_progress') AND now() > s.resolution_due_at)))::int AS resolution_due_n,
           count(*) FILTER (WHERE s.created_at > now() - make_interval(days => $1)
             AND s.resolved_at IS NOT NULL AND s.resolution_due_at IS NOT NULL
             AND s.resolved_at <= s.resolution_due_at)::int AS resolution_met
         FROM submissions s WHERE true __SCOPE__`, p) : Promise.resolve({ rows: [{}] }),
      scorecardsPromise,
      q(`SELECT to_char(date_trunc('week', s.created_at), 'YYYY-MM-DD') AS week,
            count(*) FILTER (WHERE s.first_response_due_at IS NOT NULL
              AND (s.first_response_at IS NOT NULL OR (s.held_until IS NULL AND now() > s.first_response_due_at)))::int AS resp_due,
            count(*) FILTER (WHERE s.first_response_at IS NOT NULL AND s.first_response_due_at IS NOT NULL
              AND s.first_response_at <= s.first_response_due_at)::int AS resp_met,
            count(*) FILTER (WHERE s.resolution_due_at IS NOT NULL
              AND (s.resolved_at IS NOT NULL OR (s.held_until IS NULL AND s.status IN ('new','in_progress') AND now() > s.resolution_due_at)))::int AS reso_due,
            count(*) FILTER (WHERE s.resolved_at IS NOT NULL AND s.resolution_due_at IS NOT NULL
              AND s.resolved_at <= s.resolution_due_at)::int AS reso_met
          FROM submissions s
         WHERE s.created_at > now() - make_interval(days => $1) __SCOPE__
         GROUP BY 1 ORDER BY 1`, p),
    ]);

  const pct = (met, n) => n > 0 ? Math.round((met / n) * 100) : null;
  const slaRow = slaRowQ.rows[0] || {};

  return {
    rangeDays: range,
    department: deptId,
    totals: totals.rows[0],
    csat: csat.rows[0],
    series: series.rows,
    byCategory: byCategory.rows,
    byLocation: byLocation.rows,
    byStatus: byStatus.rows,
    byType: byType.rows,
    byUrgency: byUrgency.rows,
    byTriage: byTriage.rows,
    hotspots: hotspots.rows,
    scorecards: scorecards.rows,
    trend: trend.rows.map(w => ({
      week: w.week,
      response_pct: pct(w.resp_met, w.resp_due),
      resolution_pct: pct(w.reso_met, w.reso_due),
    })),
    sla: {
      ...settings.sla,
      ...slaRow,
      response_met_pct: pct(slaRow.response_met, slaRow.response_due_n),
      resolution_met_pct: pct(slaRow.resolution_met, slaRow.resolution_due_n),
      enabled: settings.features.sla,
    },
    accountability: settings.accountability,
    features: { hotspots: settings.features.hotspots, aiInsights: settings.features.aiInsights, csat: settings.features.csat },
  };
}

// Compact stats + recent raw messages for the AI insights prompt (org-wide;
// the insights.run permission gates access).
async function insightsInput() {
  const m = await dashboardMetrics(30);
  const { rows: recent } = await pool.query(
    `SELECT s.type, s.urgency, s.message, c.name AS category,
            coalesce(l.name, nullif(s.location_text,'')) AS location
       FROM submissions s
       LEFT JOIN categories c ON c.id = s.category_id
       LEFT JOIN locations l ON l.id = s.location_id
      ORDER BY s.created_at DESC LIMIT 40`);
  const stats = {
    totals: m.totals, csat: m.csat, byCategory: m.byCategory,
    byLocation: m.byLocation, byUrgency: m.byUrgency, hotspots: m.hotspots,
    sla: m.sla, scorecards: m.scorecards,
  };
  return { stats, recent };
}

module.exports = { dashboardMetrics, insightsInput };
