/**
 * figure-wrap — promote loose <img> + caption text into
 * proper <figure><figcaption>…</figcaption></figure>.
 *
 * Detection:
 *   An <img> whose parent is <p>, <div>, <section>, <article>, or <body>
 *   (i.e. not already inside a <figure>) AND either:
 *     - has a next-sibling element that looks caption-like (class matches
 *       /caption|figure-?label/i, or small italic text under ~200 chars), OR
 *     - has a preceding-sibling paragraph starting with "Figure N:" / "Fig. N:".
 *
 * Fix:
 *   Wrap the <img> in a new <figure>, move the detected caption element's
 *   text content into a <figcaption>, and remove the original caption
 *   element from the flow.
 *
 * Deterministic; no LLM calls.
 */
import type { Rule } from '../types.js';
import {
  FIGURE_PREFIX,
  buildSelector,
  findImageBySrc,
  isInsideFigure,
  isPromotableParent,
  looksLikeCaptionElement,
  truncate,
} from '../ai/figure-helpers.js';

interface CaptionLocation {
  /** 'next' = next element sibling of the <img>, 'prev' = previous sibling. */
  position: 'next' | 'prev';
  /** The caption-bearing element; may be the img's sibling or contain the caption text. */
  element: Element;
}

export const figureWrapRule: Rule = {
  id: 'figure-wrap',
  wcag: '1.3.1',
  severity: 'warning',
  description:
    'Images with adjacent caption text should be wrapped in <figure>/<figcaption> for correct semantics.',
  fix(doc, finding) {
    const src = String(finding.data?.src ?? '');
    if (!src) return false;
    const img = findImageBySrc(doc, src);
    if (!img) return false;
    try {
      const caption = findAdjacentCaption(img);
      if (!caption) return false;
      wrapInFigure(doc, img, caption);
      return true;
    } catch (err) {
      if (process.env.DEBUG) console.error('figure-wrap fix failed:', err);
      return false;
    }
  },
  detect(doc) {
    const findings: ReturnType<Rule['detect']> = [];
    const imgs = Array.from(doc.querySelectorAll('img'));
    imgs.forEach((img, index) => {
      if (isInsideFigure(img)) return;
      if (!isPromotableParent(img.parentElement)) return;
      const caption = findAdjacentCaption(img);
      if (!caption) return;
      const src = img.getAttribute('src') ?? '(no src)';
      const captionText = (caption.element.textContent ?? '').replace(/\s+/g, ' ').trim();
      const selector = buildSelector(img, 'img', index);
      findings.push({
        message: `<img> has adjacent caption text but is not wrapped in <figure>: "${truncate(
          captionText,
          80,
        )}"`,
        selector,
        snippet: img.outerHTML.slice(0, 200),
        data: {
          src,
          captionPosition: caption.position,
          captionTag: caption.element.tagName.toLowerCase(),
          captionText: truncate(captionText, 300),
        },
      });
    });
    return findings;
  },
};

/**
 * Look to the image's immediate element siblings for something that
 * reads as a caption. We prefer the *next* sibling (convention: caption
 * follows the figure). Falls back to the *previous* sibling only when
 * it starts with "Figure N:" — that's unambiguous enough to act on.
 */
export function findAdjacentCaption(img: Element): CaptionLocation | null {
  const next = img.nextElementSibling;
  if (next && looksLikeCaptionElement(next)) {
    return { position: 'next', element: next };
  }
  const prev = img.previousElementSibling;
  if (prev) {
    const text = (prev.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (FIGURE_PREFIX.test(text)) {
      return { position: 'prev', element: prev };
    }
  }
  return null;
}

/**
 * Wrap `img` in a new <figure>, move the caption text into a
 * <figcaption>, and remove the original caption element.
 */
export function wrapInFigure(doc: Document, img: Element, caption: CaptionLocation): void {
  const parent = img.parentElement;
  if (!parent) return;

  const figure = doc.createElement('figure');
  parent.insertBefore(figure, img);
  figure.appendChild(img);

  const figcaption = doc.createElement('figcaption');
  const captionText = (caption.element.textContent ?? '').replace(/\s+/g, ' ').trim();
  figcaption.textContent = captionText;

  // Preserve caption order relative to the image:
  //   - next-sibling caption → append after img inside figure.
  //   - prev-sibling caption → keep prepended above img (common textbook style).
  if (caption.position === 'prev') {
    figure.insertBefore(figcaption, img);
  } else {
    figure.appendChild(figcaption);
  }

  // Remove the original caption node now that its content has been absorbed.
  caption.element.remove();
}
