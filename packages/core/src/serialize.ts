import { parseFragment, serialize } from 'parse5';

/**
 * Re-serialize HTML through parse5 to produce a canonical form.
 *
 * Empirically, parse5's serializer and jsdom's `innerHTML` getter produce
 * identical output for the differences we care about — `<br />` → `<br>`,
 * `&#9879;` → `⚗`, `&mdash;` → `—`. Both are HTML5-conformant; the
 * normalization is spec behavior, not a library quirk. Swapping one for
 * the other is a no-op.
 *
 * This helper exists so we can compare two HTML strings for *semantic*
 * equality — anything that canonicalizes to the same string differs only
 * in serializer-noise, and is safe to treat as "no change".
 */
export function canonicalizeHtml(html: string): string {
  return serialize(parseFragment(html));
}

/**
 * True when `before` and `after` canonicalize to the same bytes — i.e.
 * any diff between them is pure serializer noise (br normalization,
 * entity decoding, attribute quoting) with no semantic effect.
 *
 * Use this to avoid writing noise-only revisions to CXone. A byte-level
 * round-trip through jsdom (parse → innerHTML) introduces ~10-50 bytes
 * of noise on a typical page; without this guard, every pipeline run
 * that applies zero fixes still writes a revision.
 */
export function isNoiseOnlyChange(before: string, after: string): boolean {
  if (before === after) return true;
  return canonicalizeHtml(before) === canonicalizeHtml(after);
}
