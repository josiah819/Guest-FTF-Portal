import React, { useEffect, useRef } from 'react';

// Official Google Identity Services button. Renders nothing when no client id
// is configured, so every caller can drop it in unconditionally.
let gsiLoader = null;
function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gsiLoader) {
    gsiLoader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = resolve;
      s.onerror = () => { gsiLoader = null; reject(new Error('Google sign-in failed to load — check your connection.')); };
      document.head.appendChild(s);
    });
  }
  return gsiLoader;
}

export default function GoogleButton({ clientId, onCredential, onError, text = 'continue_with' }) {
  const holder = useRef(null);

  useEffect(() => {
    if (!clientId) return undefined;
    let gone = false;
    loadGsi().then(() => {
      if (gone || !holder.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp) => onCredential(resp.credential),
      });
      window.google.accounts.id.renderButton(holder.current, {
        theme: 'outline', size: 'large', text, width: 280,
      });
    }).catch(err => onError?.(err.message));
    return () => { gone = true; };
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!clientId) return null;
  return <div ref={holder} style={{ display: 'flex', justifyContent: 'center' }} />;
}
