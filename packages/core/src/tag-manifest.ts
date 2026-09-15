/**
 * Helpers for building a tag-restore manifest from the *rendered* source book.
 *
 * The Deki API on bio.libretexts.org is 403 to anonymous callers, but every
 * rendered page carries its tag list in `<div id="pageTagsHolder">`, which
 * LicenseControl itself reads. That is the read path used here.
 */

const SANDBOX_BOOK_ROOT = 'Sandboxes/johnnyphung/biology/';
const SOURCE_BOOK_ROOT = 'Bookshelves/Introductory_and_General_Biology/Biology_(Kimball)/';

/** Sandbox page path → the same page in the public Kimball book. */
export function sourcePathFor(sandboxPath: string): string {
  if (!sandboxPath.startsWith(SANDBOX_BOOK_ROOT)) {
    throw new Error(`Not a Biology sandbox path (expected ${SANDBOX_BOOK_ROOT}…): ${sandboxPath}`);
  }
  return SOURCE_BOOK_ROOT + sandboxPath.slice(SANDBOX_BOOK_ROOT.length);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Tag list from a rendered CXone page, or null when the holder is absent. */
export function parseRenderedTags(html: string): string[] | null {
  const m = /<div[^>]*id="pageTagsHolder"[^>]*>([\s\S]*?)<\/div>/.exec(html);
  if (!m) return null;
  const parsed: unknown = JSON.parse(decodeEntities(m[1]).replace(/\\/g, ''));
  return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : null;
}
