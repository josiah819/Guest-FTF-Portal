// Submissions sent from this browser. The public code never faces the guest —
// this device list is how they get back to their notes (scan the sign again →
// "My submissions"). Kiosks are shared screens and must never call remember().
const SUBS_KEY = 'woodsvoice_submissions';
const MAX = 20;

export function listMySubmissions() {
  try {
    const arr = JSON.parse(localStorage.getItem(SUBS_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter(s => s && typeof s.code === 'string' && s.code) : [];
  } catch {
    return [];
  }
}

// Returns whether the entry actually persisted (some private modes drop writes
// silently) so callers don't promise "saved on this device" when it wasn't.
export function rememberSubmission({ code, message = '', location = '', createdAt = '' }) {
  if (!code) return false;
  try {
    const rest = listMySubmissions().filter(s => s.code !== code);
    const entry = {
      code,
      message: String(message || '').slice(0, 200),
      location: String(location || ''),
      createdAt: createdAt || new Date().toISOString(),
    };
    localStorage.setItem(SUBS_KEY, JSON.stringify([entry, ...rest].slice(0, MAX)));
    return listMySubmissions().some(s => s.code === code);
  } catch {
    return false;
  }
}

export function forgetSubmission(code) {
  try {
    localStorage.setItem(SUBS_KEY, JSON.stringify(listMySubmissions().filter(s => s.code !== code)));
  } catch { /* ignore */ }
}
