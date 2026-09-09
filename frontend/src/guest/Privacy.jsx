import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { applyTheme } from '../theme';
import useSoftReload from '../useSoftReload';
import { DEFAULT_POLICY } from '../policyContent';

// Privacy pages. Both live on the guest surface so they're readable without an
// account — the staff notice matters most before someone accepts an invite.
// The text is editable in Settings → Content → Privacy pages; an empty
// override falls back to the built-in policy in policyContent.js.

// ---------- light markdown ----------
// Supported: ## heading · "- " bullets · **bold** · *italic* · [label](url).
// Rendered as React elements (never raw HTML), so edited policy text can't
// inject markup. Internal links (/track etc.) stay client-side routed.

const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)\s]+)\)/;

function renderInline(text) {
  const parts = [];
  let rest = text;
  let i = 0;
  while (rest) {
    const m = rest.match(INLINE);
    if (!m) { parts.push(rest); break; }
    if (m.index > 0) parts.push(rest.slice(0, m.index));
    if (m[1] != null) {
      parts.push(<strong key={i}>{m[1]}</strong>);
    } else if (m[2] != null) {
      parts.push(<em key={i}>{m[2]}</em>);
    } else if (m[4].startsWith('/')) {
      parts.push(<Link key={i} to={m[4]}>{m[3]}</Link>);
    } else {
      parts.push(<a key={i} href={m[4]} target="_blank" rel="noreferrer">{m[3]}</a>);
    }
    rest = rest.slice(m.index + m[0].length);
    i += 1;
  }
  return parts;
}

function Markdown({ text }) {
  const blocks = [];
  let list = [];
  let para = [];
  const flush = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{renderInline(para.join(' '))}</p>);
    para = [];
    if (list.length) {
      blocks.push(<ul key={blocks.length}>{list.map((li, i) => <li key={i}>{renderInline(li)}</li>)}</ul>);
    }
    list = [];
  };
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith('## ')) { flush(); blocks.push(<h2 key={blocks.length}>{renderInline(line.slice(3))}</h2>); continue; }
    if (line.startsWith('- ')) {
      if (para.length) flush();
      list.push(line.slice(2));
      continue;
    }
    if (list.length) flush();
    para.push(line);
  }
  flush();
  return blocks;
}

// ---------- pages ----------

function PolicyPage({ which, kicker, title }) {
  const [config, setConfig] = useState(null);

  useEffect(() => {
    api.publicConfig()
      .then(cfg => { setConfig(cfg); applyTheme(cfg.content?.branding); })
      .catch(() => setConfig({}));
    window.scrollTo({ top: 0 });
  }, []);

  useSoftReload(() => {
    api.publicConfig()
      .then(cfg => { setConfig(cfg); applyTheme(cfg.content?.branding); })
      .catch(() => {});
  });

  const branding = config?.content?.branding || {};
  const orgName = config?.general?.orgName || 'Muskoka Woods';
  const override = config?.content?.privacy?.[which] || {};
  const body = (override.body || '').trim() || DEFAULT_POLICY[which].body;
  const updated = (override.updated || '').trim() || DEFAULT_POLICY[which].updated;

  return (
    <div className="guest-shell">
      <header className="guest-top rise">
        <Link to="/"><img src={branding.logoLight || '/brand/mw-logo-white.png'} alt={orgName} /></Link>
      </header>

      <section className="guest-hero rise rise-1">
        <div className="kicker">{kicker}</div>
        <h1 className="display">{title}</h1>
      </section>

      <main className="guest-card policy rise rise-2">
        {config && (
          <>
            <p className="policy-date">Last updated {updated}</p>
            <Markdown text={body} />
          </>
        )}
      </main>

      <footer className="guest-foot rise rise-3">
        <span>© {new Date().getFullYear()} {orgName}</span>
        <span className="guest-foot__links">
          <Link to="/">← Back to the form</Link>
        </span>
      </footer>
    </div>
  );
}

export function GuestPrivacy() {
  return <PolicyPage which="guest" kicker="Your privacy" title="Privacy policy" />;
}

export function StaffPrivacy() {
  return <PolicyPage which="staff" kicker="For the team" title="Staff privacy notice" />;
}
