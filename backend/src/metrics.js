const { pool, getSettings } = require('./db');

// All dashboard numbers in one query batch. `days` bounds the range (7/30/90).
async function dashboardMetrics(days = 30) {
  const range = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365);
  const settings = await getSettings();
  const p = [range];

  const [totals, series, byCategory, byLocation, byStatus, byType, byUrgency, csat, hotspots, slaBreach] =
    await Promise.all([
      pool.query(
        `SELECT
           count(*) FILTER (WHERE created_at > now() - make_interval(days => $1))::int AS in_range,
           count(*) FILTER (WHERE status IN ('new','in_progress'))::int AS open,
           count(*) FILTER (WHERE status = 'new')::int AS unread,
           count(*) FILTER (WHERE urgency = 'safety' AND status IN ('new','in_progress'))::int AS safety_open,
           count(*) FILTER (WHERE type = 'compliment' AND created_at > now() - make_interval(days => $1))::int AS compliments,
           round(avg(EXTRACT(EPOCH FROM (first_response_at - created_at)) / 3600.0)
             FILTER (WHERE first_response_at IS NOT NULL AND created_at > now() - make_interval(days => $1))::numeric, 1) AS avg_first_response_h,
           round(avg(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600.0)
             FILTER (WHERE resolved_at IS NOT NULL AND created_at > now() - make_interval(days => $1))::numeric, 1) AS avg_resolution_h
         FROM submissions`, p),
      pool.query(
        `SELECT to_char(d.day, 'YYYY-MM-DD') AS day, coalesce(n.count, 0)::int AS count
           FROM generate_series(date_trunc('day', now()) - make_interval(days => $1 - 1),
                                date_trunc('day', now()), '1 day') AS d(day)
           LEFT JOIN (
             SELECT date_trunc('day', created_at) AS day, count(*) AS count
               FROM submissions WHERE created_at > date_trunc('day', now()) - make_interval(days => $1 - 1)
              GROUP BY 1) n ON n.day = d.day
          ORDER BY d.day`, p),
      pool.query(
        `SELECT coalesce(c.name, 'Uncategorized') AS label, coalesce(c.emoji,'❔') AS emoji, count(*)::int AS count
           FROM submissions s LEFT JOIN categories c ON c.id = s.category_id
          WHERE s.created_at > now() - make_interval(days => $1)
          GROUP BY 1, 2 ORDER BY count DESC`, p),
      pool.query(
        `SELECT coalesce(l.name, nullif(s.location_text,''), 'Unknown') AS label, count(*)::int AS count
           FROM submissions s LEFT JOIN locations l ON l.id = s.location_id
          WHERE s.created_at > now() - make_interval(days => $1)
          GROUP BY 1 ORDER BY count DESC LIMIT 8`, p),
      pool.query(
        `SELECT status AS label, count(*)::int AS count FROM submissions
          WHERE created_at > now() - make_interval(days => $1) GROUP BY 1`, p),
      pool.query(
        `SELECT type AS label, count(*)::int AS count FROM submissions
          WHERE created_at > now() - make_interval(days => $1) GROUP BY 1 ORDER BY count DESC`, p),
      pool.query(
        `SELECT urgency AS label, count(*)::int AS count FROM submissions
          WHERE created_at > now() - make_interval(days => $1) GROUP BY 1`, p),
      pool.query(
        `SELECT round(avg(rating)::numeric, 1) AS avg, count(rating)::int AS n
           FROM submissions WHERE rating IS NOT NULL AND created_at > now() - make_interval(days => $1)`, p),
      settings.features.hotspots ? pool.query(
        `SELECT coalesce(l.name, nullif(s.location_text,''), 'Unknown') AS location,
                coalesce(c.name, 'Uncategorized') AS category, count(*)::int AS count
           FROM submissions s
           LEFT JOIN locations l ON l.id = s.location_id
           LEFT JOIN categories c ON c.id = s.category_id
          WHERE s.created_at > now() - interval '7 days' AND s.type IN ('issue','request')
          GROUP BY 1, 2 HAVING count(*) >= 2
          ORDER BY count DESC LIMIT 5`, []) : Promise.resolve({ rows: [] }),
      settings.features.sla ? pool.query(
        `SELECT
           count(*) FILTER (WHERE first_response_at IS NULL AND status = 'new'
             AND created_at < now() - make_interval(hours => $1))::int AS response_overdue,
           count(*) FILTER (WHERE resolved_at IS NULL AND status IN ('new','in_progress')
             AND created_at < now() - make_interval(hours => $2))::int AS resolution_overdue
         FROM submissions`,
        [settings.sla.firstResponseHours, settings.sla.resolutionHours]) : Promise.resolve({ rows: [{}] }),
    ]);

  return {
    rangeDays: range,
    totals: totals.rows[0],
    csat: csat.rows[0],
    series: series.rows,
    byCategory: byCategory.rows,
    byLocation: byLocation.rows,
    byStatus: byStatus.rows,
    byType: byType.rows,
    byUrgency: byUrgency.rows,
    hotspots: hotspots.rows,
    sla: { ...settings.sla, ...slaBreach.rows[0], enabled: settings.features.sla },
    features: { hotspots: settings.features.hotspots, aiInsights: settings.features.aiInsights, csat: settings.features.csat },
  };
}

// Compact stats + recent raw messages for the AI insights prompt.
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
    byLocation: m.byLocation, byUrgency: m.byUrgency, hotspots: m.hotspots, sla: m.sla,
  };
  return { stats, recent };
}

module.exports = { dashboardMetrics, insightsInput };
