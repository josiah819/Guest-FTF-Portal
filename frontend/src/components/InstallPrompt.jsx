import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getStashedInstall, isStaffPath, onStashedInstall, promptInstall } from '../pwaInstall';

const DISMISS_KEY = 'wv-install-dismissed';

// Staff-side install offer, shown only when the browser's own prompt already
// fired and was swallowed on a guest page (see pwaInstall.js). A fresh load
// of /admin keeps the native prompt instead, so this never doubles it.
export default function InstallPrompt() {
  const { pathname } = useLocation();
  const [stash, setStash] = useState(getStashedInstall());
  const [dismissed, setDismissed] = useState(() => {
    try { return !!localStorage.getItem(DISMISS_KEY); } catch { return false; }
  });

  useEffect(() => onStashedInstall(setStash), []);

  if (!isStaffPath(pathname) || !stash || dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
  }

  return (
    <div className="pwa-install rise">
      <div className="pwa-install__text">
        <strong>Add WoodsVoice to your home screen?</strong>
        <span>One tap to Guest Care HQ.</span>
      </div>
      <button className="btn btn-primary btn-small" onClick={() => promptInstall()}>Install</button>
      <button className="pwa-install__x" aria-label="Dismiss" onClick={dismiss}>✕</button>
    </div>
  );
}
