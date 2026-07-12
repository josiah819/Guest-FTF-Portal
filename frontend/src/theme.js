// Applies admin-chosen brand colours as CSS custom properties, with derived
// shades so buttons, hovers and tints stay coherent. When a colour equals the
// shipped default the override is removed entirely — the hand-tuned palette
// in styles.css stays exact unless someone actually rebrands.

const DEFAULTS = { teal: '#1E5A64', green: '#A3CD42', orange: '#C26628' };

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(hex, target, w) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const out = rgb.map((c, i) => Math.round(c + (target[i] - c) * w));
  return `#${out.map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

const darken = (hex, w) => mix(hex, [0, 0, 0], w);
const lighten = (hex, w) => mix(hex, [255, 255, 255], w);

const VAR_SETS = {
  teal: (c) => ({
    '--teal': c,
    '--teal-dark': darken(c, 0.18),
    '--teal-deep': darken(c, 0.42),
    '--teal-mist': lighten(c, 0.88),
    '--line-teal': lighten(c, 0.72),
  }),
  green: (c) => ({
    '--green': c,
    '--green-bright': lighten(c, 0.14),
    '--green-dark': darken(c, 0.5),
  }),
  orange: (c) => ({
    '--orange': c,
    '--orange-soft': lighten(c, 0.78),
  }),
};

export function applyTheme(branding) {
  const root = document.documentElement;
  const colors = { ...DEFAULTS, ...(branding?.colors || {}) };
  for (const key of Object.keys(VAR_SETS)) {
    const vars = VAR_SETS[key](colors[key] || DEFAULTS[key]);
    const isDefault = !colors[key] || colors[key].toLowerCase() === DEFAULTS[key].toLowerCase() || !hexToRgb(colors[key]);
    for (const name of Object.keys(vars)) {
      if (isDefault || vars[name] == null) root.style.removeProperty(name);
      else root.style.setProperty(name, vars[name]);
    }
  }
}

export const BRAND_DEFAULTS = DEFAULTS;
