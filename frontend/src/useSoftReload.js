import { useEffect, useRef } from 'react';

// Pages left open — a kiosk, a wall dashboard, a guest watching their ticket —
// re-fetch their data on this cadence instead of ever needing a full reload.
export const SOFT_RELOAD_MS = 30000;

// Runs `fn` every 30s. The ref keeps a single steady interval while each tick
// still sees the latest closure (current filters, params, dirty flags).
// Hidden tabs skip their ticks; the next one after refocus catches them up.
export default function useSoftReload(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'hidden') ref.current();
    }, SOFT_RELOAD_MS);
    return () => clearInterval(id);
  }, []);
}
