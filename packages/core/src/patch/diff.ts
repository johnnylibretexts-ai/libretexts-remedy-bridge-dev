import type { DefaultTreeAdapterMap } from 'parse5';
import type { Splice } from './types.js';
import { UnsupportedMutationError } from './types.js';

type Frag = DefaultTreeAdapterMap['documentFragment'];
type AnyNode = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type TextNode = DefaultTreeAdapterMap['textNode'];

function isElement(n: AnyNode): n is Element {
  return (n as Element).tagName !== undefined;
}
function isText(n: AnyNode): n is TextNode {
  return n.nodeName === '#text';
}

function htmlAttrEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function htmlTextEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Walk original + mutated trees in parallel. Emit splices for in-scope
 * divergences. Throw UnsupportedMutationError for anything outside v1.
 *
 * `originalSource` is passed so downstream logic can compute replacement
 * text when a node's source range needs surgical slicing (attribute inserts).
 */
export function diffTrees(
  original: Frag,
  mutated: Frag,
  originalSource: string,
): Splice[] {
  const splices: Splice[] = [];
  walk(original.childNodes, mutated.childNodes, originalSource, splices);
  return splices;
}

function walk(
  origKids: AnyNode[],
  mutKids: AnyNode[],
  src: string,
  out: Splice[],
): void {
  if (origKids.length !== mutKids.length) {
    throw new UnsupportedMutationError(
      `Child count differs: ${origKids.length} vs ${mutKids.length}`,
      'unsupported-mutation',
    );
  }
  for (let i = 0; i < origKids.length; i++) {
    walkNode(origKids[i]!, mutKids[i]!, src, out);
  }
}

function walkNode(
  o: AnyNode,
  m: AnyNode,
  src: string,
  out: Splice[],
): void {
  if (o.nodeName !== m.nodeName) {
    if (!isElement(o) || !isElement(m)) {
      throw new UnsupportedMutationError(
        `Non-element tag mismatch ${o.nodeName} → ${m.nodeName}`,
        'unsupported-mutation',
      );
    }
    replaceElementTag(o, m, src, out);
    walk(o.childNodes, m.childNodes, src, out);
    return;
  }
  if (isElement(o) && isElement(m)) {
    diffAttributes(o, m, src, out);
    walk(o.childNodes, m.childNodes, src, out);
    return;
  }
  if (isText(o) && isText(m)) {
    if (o.value === m.value) return;
    const loc = o.sourceCodeLocation;
    if (!loc) {
      throw new UnsupportedMutationError(
        'Text node has no source location',
        'no-source-location',
      );
    }
    out.push({
      kind: 'text-replace',
      start: loc.startOffset,
      end: loc.endOffset,
      replacement: htmlTextEscape(m.value),
    });
    return;
  }
  if (o.nodeName === '#comment' && m.nodeName === '#comment') return;
}

function diffAttributes(
  o: Element,
  m: Element,
  src: string,
  out: Splice[],
): void {
  const loc = o.sourceCodeLocation;
  if (!loc || !loc.startTag) {
    throw new UnsupportedMutationError(
      `Element <${o.tagName}> has no start-tag source location`,
      'no-source-location',
    );
  }
  const origMap = new Map(o.attrs.map((a) => [a.name, a.value]));
  const mutMap = new Map(m.attrs.map((a) => [a.name, a.value]));

  // Changed values.
  for (const [name, mutVal] of mutMap) {
    if (!origMap.has(name)) continue;
    if (origMap.get(name) === mutVal) continue;
    const attrLoc = loc.attrs?.[name];
    if (!attrLoc) {
      throw new UnsupportedMutationError(
        `Attribute ${name} on <${o.tagName}> has no source location`,
        'no-source-location',
      );
    }
    out.push({
      kind: 'attr-change',
      start: attrLoc.startOffset,
      end: attrLoc.endOffset,
      replacement: `${name}="${htmlAttrEscape(mutVal)}"`,
    });
  }

  // Added attributes — insert just before the start tag's closing `>` / `/>`.
  for (const [name, mutVal] of mutMap) {
    if (origMap.has(name)) continue;
    const tagText = src.slice(loc.startTag.startOffset, loc.startTag.endOffset);
    const close = tagText.endsWith('/>') ? 2 : 1;
    const insertAt = loc.startTag.endOffset - close;
    out.push({
      kind: 'attr-insert',
      start: insertAt,
      end: insertAt,
      replacement: ` ${name}="${htmlAttrEscape(mutVal)}"`,
    });
  }

  // Removed attributes — splice from preceding whitespace through endOffset.
  for (const [name] of origMap) {
    if (mutMap.has(name)) continue;
    const attrLoc = loc.attrs?.[name];
    if (!attrLoc) {
      throw new UnsupportedMutationError(
        `Removed attribute ${name} on <${o.tagName}> has no source location`,
        'no-source-location',
      );
    }
    let start = attrLoc.startOffset;
    while (start > 0 && /\s/.test(src[start - 1]!)) start -= 1;
    out.push({
      kind: 'attr-unset',
      start,
      end: attrLoc.endOffset,
      replacement: '',
    });
  }
}

function replaceElementTag(
  o: Element,
  m: Element,
  src: string,
  out: Splice[],
): void {
  const loc = o.sourceCodeLocation;
  if (!loc || !loc.startTag) {
    throw new UnsupportedMutationError(
      `Cannot replace <${o.tagName}> — no startTag location`,
      'no-source-location',
    );
  }
  const oa = new Map(o.attrs.map((a) => [a.name, a.value]));
  const ma = new Map(m.attrs.map((a) => [a.name, a.value]));
  if (oa.size !== ma.size) {
    throw new UnsupportedMutationError(
      `Tag replacement attr-set size differs (${o.tagName} → ${m.tagName})`,
      'unsupported-mutation',
    );
  }
  for (const [name, val] of oa) {
    if (ma.get(name) !== val) {
      throw new UnsupportedMutationError(
        `Tag replacement attr mismatch on ${name} (${o.tagName} → ${m.tagName})`,
        'unsupported-mutation',
      );
    }
  }

  const startText = src.slice(loc.startTag.startOffset, loc.startTag.endOffset);
  const newStart = startText.replace(
    new RegExp(`^<${o.tagName}\\b`, 'i'),
    `<${m.tagName}`,
  );
  out.push({
    kind: 'start-tag-replace',
    start: loc.startTag.startOffset,
    end: loc.startTag.endOffset,
    replacement: newStart,
  });

  if (loc.endTag) {
    const endText = src.slice(loc.endTag.startOffset, loc.endTag.endOffset);
    const newEnd = endText.replace(
      new RegExp(`</${o.tagName}\\s*>`, 'i'),
      `</${m.tagName}>`,
    );
    out.push({
      kind: 'end-tag-replace',
      start: loc.endTag.startOffset,
      end: loc.endTag.endOffset,
      replacement: newEnd,
    });
  }
}
