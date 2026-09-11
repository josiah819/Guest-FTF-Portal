// Chrome offers its PWA install popup on any page that links the manifest,
// which means guests filling out the feedback form get nagged to install a
// staff tool. Guest routes swallow the beforeinstallprompt event; staff
// routes (/admin, /join) let the browser's own prompt through. The swallowed
// event is stashed so the staff side can still offer install after a
// guest -> staff navigation, where the event has already fired and won't
// refire without a full page load.

const STAFF_PATH = /^\/(admin|join)(\/|$)/;

export function isStaffPath(pathname) {
  return STAFF_PATH.test(pathname);
}

let stashed = null;
const listeners = new Set();

function notify() {
  for (const fn of listeners) fn(stashed);
}

window.addEventListener('beforeinstallprompt', e => {
  if (isStaffPath(window.location.pathname)) return;
  e.preventDefault();
  stashed = e;
  notify();
});

window.addEventListener('appinstalled', () => {
  stashed = null;
  notify();
});

export function getStashedInstall() {
  return stashed;
}

export function onStashedInstall(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function promptInstall() {
  const e = stashed;
  stashed = null;
  notify();
  if (e) await e.prompt();
}
