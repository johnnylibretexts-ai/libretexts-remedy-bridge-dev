import { JSDOM } from 'jsdom';
import { bytePreservePatch } from './patch/index.js';

/** Accept text only; never accept reviewer-supplied HTML or arbitrary selectors. */
export function reviseAltText(html: string, edits: Array<{ src: string; text: string }>, allowedSources: string[]): string {
  if (!Array.isArray(edits) || !edits.length || edits.length > 20) throw new Error('Choose 1–20 image descriptions.');
  const doc = new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
  for (const edit of edits) {
    if (!allowedSources.includes(edit.src) || typeof edit.text !== 'string' || !edit.text.trim() || edit.text.trim().length > 150) throw new Error('Use a complete description of 1–150 characters for an image in this preview.');
    const matches = Array.from(doc.querySelectorAll('img')).filter(img => img.getAttribute('src') === edit.src);
    if (matches.length !== 1) throw new Error('Image is not uniquely identified in this preview.');
    matches[0].setAttribute('alt', edit.text.trim());
  }
  const patch = bytePreservePatch(html, doc.body.innerHTML);
  if (!patch.ok || patch.bytes === undefined) throw new Error('Could not preserve page markup; preview again.');
  return patch.bytes;
}
