const TOKEN_KEY = 'woodsvoice_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);

async function request(path, { method = 'GET', body, formData, auth = false } = {}) {
  const headers = {};
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, {
    method,
    headers,
    body: formData || (body ? JSON.stringify(body) : undefined),
  });

  if (res.status === 401 && auth) {
    setToken(null);
    window.dispatchEvent(new Event('woodsvoice:logout'));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  // guest
  publicConfig: () => request('/api/public/config'),
  submit: (formData) => request('/api/public/submissions', { method: 'POST', formData }),
  track: (code) => request(`/api/public/track/${encodeURIComponent(code)}`),
  rate: (code, stars, comment) =>
    request(`/api/public/track/${encodeURIComponent(code)}/rating`, { method: 'POST', body: { stars, comment } }),

  // admin
  login: (username, password) => request('/api/admin/login', { method: 'POST', body: { username, password } }),
  changePassword: (current, next) => request('/api/admin/change-password', { method: 'POST', body: { current, next }, auth: true }),
  me: () => request('/api/admin/me', { auth: true }),

  // team & roles
  permissionCatalog: () => request('/api/admin/permissions', { auth: true }),
  users: () => request('/api/admin/users', { auth: true }),
  createUser: (body) => request('/api/admin/users', { method: 'POST', body, auth: true }),
  updateUser: (id, body) => request(`/api/admin/users/${id}`, { method: 'PATCH', body, auth: true }),
  resetUserPassword: (id) => request(`/api/admin/users/${id}/reset-password`, { method: 'POST', auth: true }),
  roles: () => request('/api/admin/roles', { auth: true }),
  createRole: (name) => request('/api/admin/roles', { method: 'POST', body: { name }, auth: true }),
  renameRole: (id, name) => request(`/api/admin/roles/${id}`, { method: 'PATCH', body: { name }, auth: true }),
  setRolePerms: (id, perms) => request(`/api/admin/roles/${id}/permissions`, { method: 'PUT', body: { perms }, auth: true }),
  deleteRole: (id) => request(`/api/admin/roles/${id}`, { method: 'DELETE', auth: true }),
  settings: () => request('/api/admin/settings', { auth: true }),
  saveSettings: (patch) => request('/api/admin/settings', { method: 'PUT', body: patch, auth: true }),
  uploadLogo: (slot, file) => {
    const fd = new FormData();
    fd.append('slot', slot);
    fd.append('logo', file);
    return request('/api/admin/branding/logo', { method: 'POST', formData: fd, auth: true });
  },
  metrics: (days) => request(`/api/admin/metrics?days=${days}`, { auth: true }),
  insights: () => request('/api/admin/insights', { method: 'POST', auth: true }),
  submissions: (params) => request(`/api/admin/submissions?${new URLSearchParams(params)}`, { auth: true }),
  submission: (id) => request(`/api/admin/submissions/${id}`, { auth: true }),
  updateSubmission: (id, patch) => request(`/api/admin/submissions/${id}`, { method: 'PATCH', body: patch, auth: true }),
  addNote: (id, note) => request(`/api/admin/submissions/${id}/notes`, { method: 'POST', body: { note }, auth: true }),
  catalog: (table) => request(`/api/admin/${table}`, { auth: true }),
  catalogCreate: (table, body) => request(`/api/admin/${table}`, { method: 'POST', body, auth: true }),
  catalogUpdate: (table, id, body) => request(`/api/admin/${table}/${id}`, { method: 'PATCH', body, auth: true }),
  catalogDelete: (table, id) => request(`/api/admin/${table}/${id}`, { method: 'DELETE', auth: true }),
};
