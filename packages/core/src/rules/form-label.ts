import type { Rule } from '../types.js';
import { inferFormLabel, deriveFallbackLabel } from '../ai/form-helpers.js';

const LABELABLE = new Set(['input', 'select', 'textarea']);
const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

/**
 * WCAG 3.3.2 Labels or Instructions — every user-facing form field needs
 * a programmatic label. Detects `<input>`, `<select>`, `<textarea>` that
 * have none of:
 *   - a wrapping `<label>`,
 *   - an associated `<label for="{id}">`,
 *   - an `aria-label`,
 *   - an `aria-labelledby` pointing at an existing id.
 *
 * Skipped: `type="hidden" | "submit" | "button" | "reset" | "image"`.
 *
 * Fix: request a short visible label from the LLM (with the field's
 * name/placeholder/type and surrounding text as context), fall back to a
 * humanized name/placeholder when the LLM is unavailable, then insert a
 * `<label for="{id}">…</label>` immediately before the field. Generates
 * an id when the field lacks one, seeded from the `name` attribute.
 */
export const formLabelRule: Rule = {
  id: 'form-label',
  wcag: '3.3.2',
  severity: 'error',
  description: 'Form fields must have an associated label (label[for], wrapping <label>, aria-label, or aria-labelledby).',

  detect(doc) {
    const findings: ReturnType<Rule['detect']> = [];
    const fields = collectFields(doc);
    fields.forEach((field, idx) => {
      if (hasLabel(doc, field)) return;
      findings.push({
        message: `<${field.tagName.toLowerCase()}${describeField(field)}> has no associated label`,
        selector: buildSelector(field, idx),
        snippet: field.outerHTML.slice(0, 240),
        data: {
          fieldIndex: idx,
          name: field.getAttribute('name') ?? undefined,
          placeholder: field.getAttribute('placeholder') ?? undefined,
          type: field.getAttribute('type') ?? undefined,
        },
      });
    });
    return findings;
  },

  async fix(doc, finding) {
    const fields = collectFields(doc);
    const idx =
      typeof finding.data?.fieldIndex === 'number'
        ? (finding.data.fieldIndex as number)
        : fields.findIndex((f) => !hasLabel(doc, f));
    const field = fields[idx];
    if (!field) return false;
    if (hasLabel(doc, field)) return false;

    const ctx = {
      name: field.getAttribute('name') ?? undefined,
      placeholder: field.getAttribute('placeholder') ?? undefined,
      type: field.getAttribute('type') ?? undefined,
      surroundingText: gatherSurroundingText(field),
    };

    let labelText = '';
    try {
      labelText = await inferFormLabel(ctx);
    } catch (err) {
      if (process.env.DEBUG) console.error('form-label inference failed:', err);
      labelText = deriveFallbackLabel(ctx);
    }
    if (!labelText) labelText = deriveFallbackLabel(ctx);
    if (!labelText) return false;

    // Ensure the field has an id we can point to.
    let id = field.getAttribute('id');
    if (!id) {
      id = ensureUniqueId(doc, seedIdFromField(field));
      field.setAttribute('id', id);
    }

    const label = doc.createElement('label');
    label.setAttribute('for', id);
    label.textContent = labelText;

    field.parentNode?.insertBefore(label, field);
    return true;
  },
};

function collectFields(doc: Document): Element[] {
  const all = Array.from(doc.querySelectorAll('input, select, textarea'));
  return all.filter((el) => {
    const tag = el.tagName.toLowerCase();
    if (!LABELABLE.has(tag)) return false;
    if (tag === 'input') {
      const type = (el.getAttribute('type') ?? 'text').toLowerCase();
      if (SKIP_INPUT_TYPES.has(type)) return false;
    }
    return true;
  });
}

function hasLabel(doc: Document, field: Element): boolean {
  const ariaLabel = field.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return true;

  const labelledBy = field.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/).filter(Boolean);
    const allPresent = ids.length > 0 && ids.every((refId) => doc.getElementById(refId));
    if (allPresent) return true;
  }

  // Wrapping <label>
  if (field.closest('label')) return true;

  // <label for="id">
  const id = field.getAttribute('id');
  if (id) {
    const escaped = cssEscape(id);
    if (doc.querySelector(`label[for="${escaped}"]`)) return true;
  }

  // title attribute is a legal-ish fallback per ARIA; treat it as accessible name.
  const title = field.getAttribute('title');
  if (title && title.trim()) return true;

  return false;
}

function describeField(field: Element): string {
  const type = field.getAttribute('type');
  const name = field.getAttribute('name');
  const parts: string[] = [];
  if (type) parts.push(` type="${type}"`);
  if (name) parts.push(` name="${name}"`);
  return parts.join('');
}

function buildSelector(field: Element, idx: number): string {
  const tag = field.tagName.toLowerCase();
  const id = field.getAttribute('id');
  if (id) return `${tag}#${cssEscape(id)}`;
  const name = field.getAttribute('name');
  if (name) return `${tag}[name="${cssEscape(name)}"]`;
  return `${tag}:nth-of-type(${idx + 1})`;
}

function gatherSurroundingText(field: Element): string {
  // Look at up to two preceding siblings and the parent's text for context.
  const parts: string[] = [];
  let node: Node | null = field.previousSibling;
  let hops = 0;
  while (node && hops < 4) {
    const text = (node.textContent ?? '').trim();
    if (text) parts.unshift(text);
    node = node.previousSibling;
    hops++;
  }
  const parent = field.parentElement;
  if (parent) {
    const parentText = Array.from(parent.childNodes)
      .filter((n) => n.nodeType === 3 /* Text */)
      .map((n) => (n.textContent ?? '').trim())
      .filter(Boolean)
      .join(' ');
    if (parentText) parts.push(parentText);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function seedIdFromField(field: Element): string {
  const name = field.getAttribute('name') ?? '';
  const seed = name
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  if (seed && /^[a-z]/.test(seed)) return `field-${seed}`;
  return 'field';
}

function ensureUniqueId(doc: Document, base: string): string {
  if (!doc.getElementById(base)) return base;
  let i = 2;
  while (doc.getElementById(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function cssEscape(value: string): string {
  // Minimal CSS.escape polyfill: escape any char that isn't [A-Za-z0-9_-]
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}
