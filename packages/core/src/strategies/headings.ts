import { BaseStrategy } from './base.js';
import type { InternalStrategyContext, StrategyReport } from './types.js';

/**
 * HeadingStrategy
 *
 * Two passes, cheap-first:
 *   1. Deterministic: promote `<p><strong>short text</strong></p>` patterns to
 *      real headings, mirroring the `heading-as-bold` rule's fix logic so the
 *      strategy runner can work on HTML that bypassed the rule layer.
 *   2. LLM-assisted: if heading levels are chaotic (skipped levels or a run
 *      of mismatched depths), ask the LLM to propose a normalized outline.
 *      Falls back to a simple level-walk if LLM isn't available.
 *
 * Port of `HeadingRemediation` in the sibling project's
 * accessibility_strategies.py.
 */
export class HeadingStrategy extends BaseStrategy {
  readonly id = 'headings';
  readonly description =
    'Promote bold-as-heading paragraphs and normalize heading levels.';

  protected async run(
    doc: Document,
    ctx: InternalStrategyContext,
    report: StrategyReport,
  ): Promise<void> {
    this.demoteAuthoredH1(doc, report);
    this.promoteBoldHeadings(doc, report);
    this.fillEmptyHeadings(doc, report);
    await this.normalizeLevels(doc, ctx, report);
  }

  /**
   * LibreTexts / CXone renders a page-level `<h1>` as part of the platform
   * chrome (the page title in the header wrapper we strip in scan.ts). An
   * authored `<h1>` inside the body therefore produces a second h1 at render
   * time — a WCAG 2.4.6 ("Headings and Labels") and structure violation.
   * Demote all authored h1s to h2 before heading-order work runs.
   */
  private demoteAuthoredH1(doc: Document, report: StrategyReport): void {
    const h1s = Array.from(doc.querySelectorAll('h1')) as HTMLElement[];
    for (const h1 of h1s) {
      const h2 = doc.createElement('h2');
      for (const attr of Array.from(h1.attributes)) {
        h2.setAttribute(attr.name, attr.value);
      }
      while (h1.firstChild) h2.appendChild(h1.firstChild);
      h1.parentNode?.replaceChild(h2, h1);
      const text = truncate(h2.textContent ?? '', 60);
      report.fixesApplied.push(
        `Demoted authored <h1> -> <h2> ("${text}") — platform provides page h1`,
      );
    }
  }

  /**
   * Turn `<p><strong>Short Title</strong></p>` into an `<hN>` based on the
   * deepest preceding heading (+1, capped at h4). Same heuristic as
   * rules/heading-as-bold.ts.
   */
  private promoteBoldHeadings(doc: Document, report: StrategyReport): void {
    const paragraphs = Array.from(doc.querySelectorAll('p'));
    for (const p of paragraphs) {
      const text = (p.textContent ?? '').trim();
      if (!text || text.length > 120) continue;
      if (/[.!?:;]$/.test(text)) continue; // real sentences end with punctuation
      const kids = Array.from(p.children);
      if (kids.length !== 1) continue;
      if (p.childNodes.length !== 1) continue;
      const tag = kids[0]!.tagName;
      if (!/^(STRONG|B)$/.test(tag)) continue;

      const level = Math.min(4, this.deepestPrecedingLevel(p) + 1);
      const heading = doc.createElement(`h${level}`);
      heading.textContent = text;
      p.parentNode?.replaceChild(heading, p);
      report.fixesApplied.push(
        `Promoted bold paragraph to <h${level}>: "${truncate(text, 60)}"`,
      );
    }
  }

  /**
   * Replace whitespace-only headings with a stable placeholder. We don't burn
   * an LLM call for each empty heading — that's an expensive way to write
   * "Section N" — unless the LLM is cheap (never is). If an LLM call comes
   * in budget, ask it for a better title based on the next <p>.
   */
  private fillEmptyHeadings(doc: Document, report: StrategyReport): void {
    const headings = Array.from(
      doc.querySelectorAll('h1,h2,h3,h4,h5,h6'),
    ) as HTMLElement[];
    let sectionCounter = 0;
    for (const h of headings) {
      const text = (h.textContent ?? '').trim();
      if (text) continue;
      sectionCounter += 1;
      h.textContent = `Section ${sectionCounter}`;
      report.fixesApplied.push(
        `Filled empty <${h.tagName.toLowerCase()}> with placeholder "Section ${sectionCounter}"`,
      );
    }
  }

  /**
   * Walk the heading list and clamp any level that skips (e.g. h2 -> h4).
   * Mirrors `_fix_skipped_levels` from the Python port.
   *
   * If the structure is still chaotic after walking (e.g. the page starts
   * with an h4, or there are >2 skipped spans), ask the LLM once for an
   * outline rewrite. LLM output is advisory — we only apply it when the
   * response maps cleanly to existing headings.
   */
  private async normalizeLevels(
    doc: Document,
    ctx: InternalStrategyContext,
    report: StrategyReport,
  ): Promise<void> {
    const headings = Array.from(
      doc.querySelectorAll('h1,h2,h3,h4,h5,h6'),
    ) as HTMLElement[];
    if (headings.length === 0) return;

    let chaosScore = 0;
    let maxAllowed = this.startingLevel(doc);
    for (const h of headings) {
      const lvl = Number(h.tagName.substring(1));
      if (lvl > maxAllowed) {
        chaosScore += lvl - maxAllowed;
        const clamped = maxAllowed;
        if (clamped !== lvl) {
          const newTag = doc.createElement(`h${clamped}`);
          // copy attributes & children
          for (const attr of Array.from(h.attributes)) {
            newTag.setAttribute(attr.name, attr.value);
          }
          while (h.firstChild) newTag.appendChild(h.firstChild);
          h.parentNode?.replaceChild(newTag, h);
          report.fixesApplied.push(
            `Clamped <${h.tagName.toLowerCase()}> -> <h${clamped}> to avoid level skip`,
          );
        }
        maxAllowed = clamped + 1;
      } else {
        maxAllowed = lvl + 1;
      }
    }

    // Only spend an LLM call if the outline still looks chaotic enough to
    // warrant one. Threshold is deliberately conservative.
    if (chaosScore < 3) return;
    if (ctx.budget.exhausted) return;

    const outline = headings
      .map((h, i) => `${i + 1}. <${h.tagName.toLowerCase()}> ${truncate(h.textContent ?? '', 80)}`)
      .join('\n');
    const prompt =
      'The following is the heading outline of a textbook page. Each line ' +
      'shows the current heading level and text. Propose a corrected, ' +
      'contiguous heading hierarchy (no skipped levels) starting from h2 ' +
      '(because h1 is provided by the platform chrome). Respond ONLY with ' +
      'lines of the form "N. hK" where N is the original line number and ' +
      'K is the new level 2-6. No prose.\n\n' + outline;
    const response = await this.callChat(ctx, report, prompt, {
      maxTokens: 300,
      temperature: 0.1,
    });
    if (!response) return;

    const proposal = parseOutlineProposal(response, headings.length);
    if (!proposal) return;
    for (const [index, newLevel] of proposal) {
      const h = headings[index];
      if (!h) continue;
      const current = Number(h.tagName.substring(1));
      if (current === newLevel) continue;
      const newTag = doc.createElement(`h${newLevel}`);
      for (const attr of Array.from(h.attributes)) {
        newTag.setAttribute(attr.name, attr.value);
      }
      while (h.firstChild) newTag.appendChild(h.firstChild);
      h.parentNode?.replaceChild(newTag, h);
      report.fixesApplied.push(
        `LLM outline: <h${current}> -> <h${newLevel}> ("${truncate(newTag.textContent ?? '', 40)}")`,
      );
    }
  }

  private startingLevel(_doc: Document): number {
    // LibreTexts content always starts at h2 — the platform renders the
    // page's h1 in chrome. demoteAuthoredH1() has already removed any
    // authored h1s by the time normalizeLevels() runs.
    return 2;
  }

  private deepestPrecedingLevel(el: Element): number {
    let node: Element | null = el.previousElementSibling;
    let deepest = 2;
    while (node) {
      const tag = node.tagName;
      if (/^H[1-6]$/.test(tag)) {
        deepest = Math.max(deepest, Number(tag.substring(1)));
        break;
      }
      node = node.previousElementSibling;
    }
    return deepest;
  }
}

function parseOutlineProposal(raw: string, expected: number): Array<[number, number]> | null {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: Array<[number, number]> = [];
  for (const line of lines) {
    // Accept shapes:  "3. h2"  "3) h2"  "3 h2"
    const m = line.match(/^(\d+)[\.\)\s]+h([1-6])\b/i);
    if (!m) continue;
    const index = parseInt(m[1]!, 10) - 1;
    const level = parseInt(m[2]!, 10);
    if (index < 0 || index >= expected) continue;
    if (level < 1 || level > 6) continue;
    out.push([index, level]);
  }
  // Require the proposal to cover at least half the headings to be worth using.
  if (out.length < Math.max(2, Math.floor(expected / 2))) return null;
  return out;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
