// Matching between RAP's free-form department labels and our local department
// names, shared by the inbox scope filter (routes/admin.js) and the push
// fan-out (webPush.js) so both answer "may this user see this ticket?" the
// same way.

// RAP department word → word to look for in our department names
// (their "Kitchen" is our "Food Services").
const DEPT_ALIASES = { kitchen: 'food' };

// Returns the subset of RAP labels that match one of the given local
// department names. Whole-word matching — a short label like "it" must not
// claim "Facil-it-ies".
function matchDeptLabels(deptNames, allLabels) {
  const tokenSets = deptNames.map(n => n.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  return allLabels.filter(label => {
    const wants = label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const aliases = wants.map(w => Object.hasOwn(DEPT_ALIASES, w) ? DEPT_ALIASES[w] : null).filter(Boolean);
    return tokenSets.some(tokens =>
      wants.every(w => tokens.includes(w)) || aliases.some(a => tokens.includes(a)));
  });
}

module.exports = { matchDeptLabels, DEPT_ALIASES };
