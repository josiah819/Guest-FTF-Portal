import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useActor } from './AdminApp';

// One-time password reveal — shown exactly once after create/reset.
function SecretNote({ secret, onDismiss }) {
  if (!secret) return null;
  return (
    <div className="secret-note" role="status">
      <div>
        <strong>{secret.username}</strong> — temporary password:
        <code>{secret.password}</code>
        <button className="btn btn-ghost btn-small" style={{ marginLeft: 8 }}
          onClick={() => navigator.clipboard?.writeText(secret.password)}>⧉ Copy</button>
      </div>
      <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
        Share it over a trusted channel. They’ll be asked to set their own password on first sign-in.
        This is the only time it’s shown.
      </p>
      <button className="close" onClick={onDismiss} aria-label="Dismiss">✕</button>
    </div>
  );
}

function DeptChips({ departments, selected, onToggle }) {
  return (
    <div className="dept-chips">
      {departments.filter(d => d.active).map(d => {
        const on = selected.includes(d.id);
        return (
          <button key={d.id} type="button" className={`chip-mini${on ? ' on' : ''}`}
            onClick={() => onToggle(d.id)} aria-pressed={on}>
            {d.name}
          </button>
        );
      })}
    </div>
  );
}

function UsersCard({ users, roles, departments, reload, setSecret, setToast }) {
  const actor = useActor();
  const blankDraft = { username: '', displayName: '', email: '', roleId: '', departmentIds: [] };
  const [draft, setDraft] = useState(blankDraft);
  const [busy, setBusy] = useState(false);

  async function createUser(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.createUser(draft);
      setSecret({ username: res.user.username, password: res.tempPassword });
      setDraft(blankDraft);
      reload();
    } catch (err) {
      setToast(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function update(id, patch) {
    try {
      await api.updateUser(id, patch);
      reload();
    } catch (err) {
      setToast(err.message);
      reload();
    }
  }

  async function resetPassword(u) {
    try {
      const res = await api.resetUserPassword(u.id);
      setSecret({ username: u.username, password: res.tempPassword });
    } catch (err) {
      setToast(err.message);
    }
  }

  return (
    <div className="card">
      <h3>Users</h3>
      <p className="hint">
        Each person signs in with their own account. What they can see and do comes from their
        role (matrix below) plus which departments they belong to.
      </p>

      <form onSubmit={createUser} className="team-add">
        <input className="input" placeholder="username" autoCapitalize="none" value={draft.username}
          onChange={e => setDraft(d => ({ ...d, username: e.target.value }))} />
        <input className="input" placeholder="Display name" value={draft.displayName}
          onChange={e => setDraft(d => ({ ...d, displayName: e.target.value }))} />
        <input className="input" placeholder="Email (for notifications)" type="email" value={draft.email}
          onChange={e => setDraft(d => ({ ...d, email: e.target.value }))} />
        <select className="input" value={draft.roleId}
          onChange={e => setDraft(d => ({ ...d, roleId: e.target.value }))}>
          <option value="">Role…</option>
          {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <DeptChips departments={departments} selected={draft.departmentIds}
          onToggle={(id) => setDraft(d => ({
            ...d,
            departmentIds: d.departmentIds.includes(id)
              ? d.departmentIds.filter(x => x !== id) : [...d.departmentIds, id],
          }))} />
        <button className="btn btn-teal btn-small" disabled={busy || !draft.username || !draft.roleId}>
          + Create user
        </button>
      </form>

      {users.map(u => (
        <div className={`team-row${u.active ? '' : ' inactive'}`} key={u.id}>
          <div className="team-row__main">
            <input className="input grow" defaultValue={u.display_name} aria-label="Display name"
              onBlur={e => e.target.value !== u.display_name && update(u.id, { displayName: e.target.value })} />
            <span className="badge">@{u.username}</span>
            {u.must_change_password && <span className="badge u-high" title="Hasn’t set their own password yet">temp pw</span>}
            <select className="input" value={u.role_id || ''} aria-label="Role"
              onChange={e => update(u.id, { roleId: e.target.value })}>
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <button className="btn btn-ghost btn-small" onClick={() => resetPassword(u)}>Reset password</button>
            <button className={`switch${u.active ? ' on' : ''}`} title={u.active ? 'Active' : 'Deactivated'}
              disabled={u.id === actor.user.id}
              onClick={() => update(u.id, { active: !u.active })} aria-label="Toggle active" />
          </div>
          <div className="team-row__sub">
            <input className="input" style={{ width: 240 }} placeholder="email" type="email" defaultValue={u.email}
              onBlur={e => e.target.value !== u.email && update(u.id, { email: e.target.value })} />
            <DeptChips departments={departments} selected={u.department_ids}
              onToggle={(id) => update(u.id, {
                departmentIds: u.department_ids.includes(id)
                  ? u.department_ids.filter(x => x !== id) : [...u.department_ids, id],
              })} />
          </div>
        </div>
      ))}
    </div>
  );
}

function RolesMatrix({ roles, permissions, reload, setToast }) {
  const [newRole, setNewRole] = useState('');

  const groups = useMemo(() => {
    const map = new Map();
    for (const p of permissions) {
      if (!map.has(p.group)) map.set(p.group, []);
      map.get(p.group).push(p);
    }
    return [...map.entries()];
  }, [permissions]);

  async function toggle(role, permKey) {
    const has = role.perms.includes(permKey);
    const next = has ? role.perms.filter(p => p !== permKey) : [...role.perms, permKey];
    try {
      await api.setRolePerms(role.id, next);
    } catch (err) {
      setToast(err.message);
    }
    reload();
  }

  async function addRole(e) {
    e.preventDefault();
    if (!newRole.trim()) return;
    try {
      await api.createRole(newRole.trim());
      setNewRole('');
      reload();
    } catch (err) {
      setToast(err.message);
    }
  }

  async function removeRole(role) {
    try {
      await api.deleteRole(role.id);
      reload();
    } catch (err) {
      setToast(err.message);
    }
  }

  return (
    <div className="card">
      <h3>Role matrix</h3>
      <p className="hint">
        Tick what each role may do — changes apply within seconds, no re-login needed.
        Administrator always has everything.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="perm-table">
          <thead>
            <tr>
              <th className="pl">Permission</th>
              {roles.map(r => (
                <th key={r.id}>
                  {r.is_system ? (
                    <span title="System role">🔒 {r.name}</span>
                  ) : (
                    <input className="input role-name" defaultValue={r.name} aria-label="Role name"
                      onBlur={e => e.target.value.trim() && e.target.value !== r.name &&
                        api.renameRole(r.id, e.target.value.trim()).then(reload).catch(err => setToast(err.message))} />
                  )}
                  <div className="muted" style={{ fontSize: 11.5, fontWeight: 400, marginTop: 2 }}>
                    {r.user_count} {r.user_count === 1 ? 'user' : 'users'}
                    {!r.is_system && r.user_count === 0 && (
                      <button className="link-danger" onClick={() => removeRole(r)}>delete</button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(([group, perms]) => (
              <React.Fragment key={group}>
                <tr className="grp"><td className="pl" colSpan={1 + roles.length}>{group}</td></tr>
                {perms.map(p => (
                  <tr key={p.key}>
                    <td className="pl">
                      <div className="pt">{p.label}</div>
                      <div className="pd">{p.desc}</div>
                    </td>
                    {roles.map(r => (
                      <td key={r.id}>
                        <input type="checkbox"
                          checked={r.is_system || r.perms.includes(p.key)}
                          disabled={r.is_system}
                          onChange={() => toggle(r, p.key)}
                          aria-label={`${r.name}: ${p.label}`} />
                      </td>
                    ))}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <form onSubmit={addRole} style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <input className="input" style={{ maxWidth: 240 }} placeholder="New role name"
          value={newRole} onChange={e => setNewRole(e.target.value)} />
        <button className="btn btn-teal btn-small" disabled={!newRole.trim()}>+ Add role</button>
      </form>
    </div>
  );
}

export default function Team() {
  const [users, setUsers] = useState(null);
  const [roles, setRoles] = useState(null);
  const [permissions, setPermissions] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [secret, setSecret] = useState(null);
  const [toast, setToast] = useState('');

  function reload() {
    api.users().then(d => setUsers(d.rows)).catch(err => setToast(err.message));
    api.roles().then(d => setRoles(d.rows)).catch(err => setToast(err.message));
  }

  useEffect(() => {
    reload();
    api.permissionCatalog().then(d => setPermissions(d.permissions));
    api.catalog('departments').then(d => setDepartments(d.rows));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  if (!users || !roles || !permissions) return <div className="center-pad"><span className="spinner" /></div>;

  return (
    <>
      <div className="admin-head">
        <div>
          <div className="kicker" style={{ color: 'var(--orange)' }}>Who does what</div>
          <h1 className="display">Team & roles</h1>
          <div className="sub">Accounts, permissions, and department membership.</div>
        </div>
      </div>

      <SecretNote secret={secret} onDismiss={() => setSecret(null)} />

      <UsersCard users={users} roles={roles} departments={departments}
        reload={reload} setSecret={setSecret} setToast={setToast} />

      <div style={{ height: 16 }} />

      <RolesMatrix roles={roles} permissions={permissions} reload={reload} setToast={setToast} />

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
