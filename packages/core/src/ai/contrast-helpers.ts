/**
 * Pure CSS color utilities for WCAG color-contrast computations.
 *
 * Ported from the sibling project-remedy-server `accessibility_strategies.py`
 * helpers (`_parse_css_color`, `_relative_luminance`, `_contrast_ratio`) plus
 * a `nearestPassingColor` helper that walks the foreground toward black or
 * white until it meets the target ratio.
 *
 * No DOM, no canvas, no LLM — these are used by ContrastStrategy because
 * axe-core running in jsdom cannot evaluate contrast (no layout / no canvas).
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Named CSS colors commonly seen inline on textbook content. Not exhaustive —
 * the CSS spec has ~150 names — but covers what we actually see on
 * LibreTexts pages and the ones the Python prior-art handled.
 */
const NAMED_COLORS: Record<string, RGB> = {
  black: { r: 0, g: 0, b: 0 },
  white: { r: 255, g: 255, b: 255 },
  red: { r: 255, g: 0, b: 0 },
  green: { r: 0, g: 128, b: 0 },
  blue: { r: 0, g: 0, b: 255 },
  yellow: { r: 255, g: 255, b: 0 },
  orange: { r: 255, g: 165, b: 0 },
  purple: { r: 128, g: 0, b: 128 },
  brown: { r: 165, g: 42, b: 42 },
  maroon: { r: 128, g: 0, b: 0 },
  navy: { r: 0, g: 0, b: 128 },
  teal: { r: 0, g: 128, b: 128 },
  olive: { r: 128, g: 128, b: 0 },
  silver: { r: 192, g: 192, b: 192 },
  gray: { r: 128, g: 128, b: 128 },
  grey: { r: 128, g: 128, b: 128 },
  lime: { r: 0, g: 255, b: 0 },
  aqua: { r: 0, g: 255, b: 255 },
  cyan: { r: 0, g: 255, b: 255 },
  fuchsia: { r: 255, g: 0, b: 255 },
  magenta: { r: 255, g: 0, b: 255 },
  darkred: { r: 139, g: 0, b: 0 },
  darkgreen: { r: 0, g: 100, b: 0 },
  darkblue: { r: 0, g: 0, b: 139 },
  darkgray: { r: 169, g: 169, b: 169 },
  darkgrey: { r: 169, g: 169, b: 169 },
  lightgray: { r: 211, g: 211, b: 211 },
  lightgrey: { r: 211, g: 211, b: 211 },
  transparent: { r: 255, g: 255, b: 255 },
};

/**
 * Parse a CSS color value to an {r,g,b} triple. Returns null on failure.
 *
 * Supports:
 *   - #RGB, #RRGGBB, #RRGGBBAA (alpha ignored)
 *   - rgb(...) and rgba(...) (alpha ignored)
 *   - the named colors in NAMED_COLORS
 */
export function parseCssColor(value: string | null | undefined): RGB | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;

  const named = NAMED_COLORS[v];
  if (named) return { ...named };

  const hex = /^#([0-9a-f]{3,8})$/.exec(v);
  if (hex) {
    const h = hex[1]!;
    if (h.length === 3 || h.length === 4) {
      return {
        r: parseInt(h[0]! + h[0]!, 16),
        g: parseInt(h[1]! + h[1]!, 16),
        b: parseInt(h[2]! + h[2]!, 16),
      };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
      };
    }
    return null;
  }

  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(v);
  if (rgb) {
    return {
      r: clamp(parseInt(rgb[1]!, 10)),
      g: clamp(parseInt(rgb[2]!, 10)),
      b: clamp(parseInt(rgb[3]!, 10)),
    };
  }

  return null;
}

/** WCAG sRGB relative luminance. */
export function relativeLuminance(r: number, g: number, b: number): number {
  const toLin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

/** WCAG contrast ratio between two colors. Always >= 1. */
export function contrastRatio(a: RGB, b: RGB): number {
  const l1 = relativeLuminance(a.r, a.g, a.b);
  const l2 = relativeLuminance(b.r, b.g, b.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Format an RGB triple as a CSS hex string (#RRGGBB). */
export function rgbToHex({ r, g, b }: RGB): string {
  return '#' + [r, g, b].map((c) => clamp(c).toString(16).padStart(2, '0')).join('');
}

/**
 * Find the nearest color to `fg` that achieves at least `target` contrast
 * against `bg`. Walks `fg` in sRGB toward black or white (whichever
 * direction the background suggests) in small steps.
 *
 * Returns the original color unchanged if it already passes.
 */
export function nearestPassingColor(fg: RGB, bg: RGB, target = 4.5): RGB {
  if (contrastRatio(fg, bg) >= target) return { ...fg };

  // Pick direction: move toward whichever endpoint (black or white) is
  // farther from the background -- that is the one that increases contrast.
  const bgL = relativeLuminance(bg.r, bg.g, bg.b);
  const towardBlack = bgL >= 0.5; // light background -> darken text
  const endpoint: RGB = towardBlack ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };

  let best: RGB = { ...fg };
  // 32 steps is enough to go from any color to black/white in ~8-bit steps.
  for (let step = 1; step <= 32; step++) {
    const t = step / 32;
    const candidate: RGB = {
      r: Math.round(fg.r + (endpoint.r - fg.r) * t),
      g: Math.round(fg.g + (endpoint.g - fg.g) * t),
      b: Math.round(fg.b + (endpoint.b - fg.b) * t),
    };
    best = candidate;
    if (contrastRatio(candidate, bg) >= target) return candidate;
  }
  // Couldn't hit target (shouldn't happen if endpoint is black/white against
  // any reasonable bg); return the endpoint-ish best we got.
  return best;
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 255) return 255;
  return Math.round(n);
}
