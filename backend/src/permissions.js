// The permission catalog: every gate in the app, defined in code so the
// Team page's role matrix renders straight from this list. Keys are stored
// in role_permissions; unknown keys in the DB are simply never checked.

const PERMISSIONS = [
  // Submissions
  { key: 'submissions.view_all',  group: 'Submissions', label: 'View all departments',
    desc: 'See every submission, including ones with no department yet.' },
  { key: 'submissions.view_dept', group: 'Submissions', label: 'View own departments',
    desc: 'See submissions routed to the departments this user belongs to.' },
  { key: 'submissions.respond',   group: 'Submissions', label: 'Respond',
    desc: 'Add internal notes and move items between New and In progress.' },
  { key: 'submissions.close',     group: 'Submissions', label: 'Resolve & close',
    desc: 'Mark items resolved or closed, and reopen them.' },
  { key: 'submissions.assign',    group: 'Submissions', label: 'Re-route & assign',
    desc: 'Change an item’s department, category, urgency, or assigned person.' },

  // Metrics
  { key: 'metrics.view_all',  group: 'Metrics', label: 'Dashboard — all departments',
    desc: 'Full dashboard, scorecards and trends across the whole site.' },
  { key: 'metrics.view_dept', group: 'Metrics', label: 'Dashboard — own departments',
    desc: 'Dashboard scoped to the departments this user belongs to.' },
  { key: 'insights.run', group: 'Metrics', label: 'Generate AI insights',
    desc: 'Run the AI trends analysis on the dashboard.' },
  { key: 'export.csv', group: 'Metrics', label: 'Export CSV',
    desc: 'Download the full submission dataset.' },

  // Configuration
  { key: 'settings.manage', group: 'Configuration', label: 'Manage settings',
    desc: 'Form fields, features, SLA targets, AI provider, integrations, accountability.' },
  { key: 'content.manage', group: 'Configuration', label: 'Edit content & branding',
    desc: 'All guest-facing wording, labels, the How-it-works page, logos and colours.' },
  { key: 'catalogs.manage', group: 'Configuration', label: 'Manage catalogs',
    desc: 'Add or edit categories, locations, and department names/emails.' },
  { key: 'routing.manage', group: 'Configuration', label: 'Manage hours & routing',
    desc: 'Department opening hours, after-hours fallbacks, on-call, per-department SLA overrides.' },
  { key: 'users.manage', group: 'Configuration', label: 'Manage team & roles',
    desc: 'Create users, assign roles and departments, edit the role matrix.' },
];

const PERMISSION_KEYS = PERMISSIONS.map(p => p.key);

// Starter roles seeded on first boot. Administrator is the system role: it
// always holds every key (topped up each boot) and can't be edited or deleted.
const ROLE_SEEDS = [
  { name: 'Administrator', isSystem: true, perms: PERMISSION_KEYS },
  { name: 'Department Lead', isSystem: false, perms: [
    'submissions.view_dept', 'submissions.respond', 'submissions.close', 'submissions.assign',
    'metrics.view_dept', 'export.csv',
  ] },
  { name: 'Staff', isSystem: false, perms: [
    'submissions.view_dept', 'submissions.respond',
  ] },
  { name: 'Viewer', isSystem: false, perms: [
    // Read-only leadership view: the whole picture, no buttons.
    'metrics.view_all', 'submissions.view_all',
  ] },
];

module.exports = { PERMISSIONS, PERMISSION_KEYS, ROLE_SEEDS };
