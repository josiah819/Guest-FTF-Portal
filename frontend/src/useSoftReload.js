import { useEffect, useRef } from 'react';
import { subscribe as subscribeLive } from './liveReload';

// Pages left open — a kiosk, a wall dashboard, a guest watching their ticket —
// re-fetch their data on this cadence instead of ever needing a full reload.
export const SOFT_RELOAD_MS = 30000;

// Runs `fn` every 30s, immediately when the live board-change stream pings
// (signed-in tabs only — liveReload no-ops without a token), and immediately
// when a hidden tab comes back. The ref keeps a single steady interval while
// each tick still sees the latest closure (current filters, params, dirty
// flags). Hidden tabs skip their ticks and drop live pings — a phone that
// switched over to the RAP board and back would otherwise sit on stale rows
// for up to 30s — so the visibility flip is itself a tick.
export default function useSoftReload(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'hidden') ref.current();
    }, SOFT_RELOAD_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') ref.current(); };
    const onPageShow = (e) => { if (e.persisted) ref.current(); };   // back/forward cache restore
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onPageShow);
    const unsubscribe = subscribeLive(() => ref.current());
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onPageShow);
      unsubscribe();
    };
  }, []);
}
