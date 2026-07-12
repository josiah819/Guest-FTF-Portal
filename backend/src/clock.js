// The one place "now" comes from in routing/scheduler code. FAKE_NOW (ISO
// string) lets tests freeze or jump time: set it, restart the backend, and
// every open-check, due-date and scheduler predicate follows.
function now() {
  if (process.env.FAKE_NOW) {
    const d = new Date(process.env.FAKE_NOW);
    if (!Number.isNaN(d.getTime())) return d;
    console.warn('[clock] FAKE_NOW is not a valid date — using real time');
  }
  return new Date();
}

module.exports = { now };
