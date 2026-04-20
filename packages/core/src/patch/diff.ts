import type { DefaultTreeAdapterMap } from 'parse5';
import { serialize } from 'parse5';
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
 * divergences. Throw UnsupportedMutationError for anything outside v1+v2.
 *
 * `originalSource` is passed so downstream logic can compute replacement
 * text when a node's source range needs surgical slicing (attribute inserts).
 *
 * v1 scope: attribute set/unset/change, text content, element tag rename
 * (e.g. h1→h2 with preserved attrs + children).
 *
 * v2 adds:
 *   - children-insert: new children appended or interleaved into an
 *     existing element (flowchart-ol / chart-longdesc: augment existing
 *     <figure> with <figcaption>/<ol>/<details>/<table>).
 *   - element-wrap: a bare element gets wrapped in a new container
 *     (ocr-text: <img> → <figure><img>…OCR HTML…</figure>).
 */
export function diffTrees(
  original: Frag,
  mutated: Frag,
  originalSource: string,
  parent: Element | Frag = original,
): Splice[] {
  const splices: Splice[] = [];
  walk(original.childNodes, mutated.childNodes, originalSource, splices, parent);
  return splices;
}

function walk(
  origKids: AnyNode[],
  mutKids: AnyNode[],
  src: string,
  out: Splice[],
  parent: Element | Frag,
): void {
  if (origKids.length === mutKids.length) {
    for (let i = 0; i < origKids.length; i++) {
      walkNode(origKids[i]!, mutKids[i]!, src, out);
    }
    return;
  }

  // v2: try to align origKids as a contiguous subsequence inside mutKids
  // (children-insert path).
  const alignment = alignByStructure(origKids, mutKids);
  if (alignment) {
    applyAlignment(alignment, origKids, mutKids, src, out, parent);
    return;
  }

  // v2: single-original wrapped in a single new element case
  // (element-wrap path — ocr-text).
  if (origKids.length === 1 && mutKids.length === 1) {
    const wrap = tryElementWrap(origKids[0]!, mutKids[0]!, src);
    if (wrap) {
      out.push(wrap);
      return;
    }
  }

  throw new UnsupportedMutationError(
    `Child count differs: ${origKids.length} vs ${mutKids.length} (no alignment or wrap detected)`,
    'unsupported-mutation',
  );
}

/**
 * Try to match every original child to a mutated child in order, leaving
 * some mutated children as "new" insertions. Returns a mapping from
 * origIndex → mutIndex, or null if we can't align.
 *
 * Currently greedy-by-structure: an original child matches a mutated
 * child if same nodeName + (for elements) same tagName + same attr map.
 * We do NOT require text/attribute values to match — later recursion
 * handles those via attribute/text splices.
 */
function alignByStructure(
  origKids: AnyNode[],
  mutKids: AnyNode[],
): number[] | null {
  if (origKids.length > mutKids.length) return null; // only inserts (not deletes) in v2
  const mapping: number[] = [];
  let mi = 0;
  for (let oi = 0; oi < origKids.length; oi++) {
    while (mi < mutKids.length && !nodesCouldCorrelate(origKids[oi]!, mutKids[mi]!)) {
      mi++;
    }
    if (mi >= mutKids.length) return null;
    mapping.push(mi);
    mi++;
  }
  return mapping;
}

function nodesCouldCorrelate(o: AnyNode, m: AnyNode): boolean {
  if (o.nodeName !== m.nodeName) return false;
  if (isElement(o) && isElement(m)) {
    // Same tag; attribute set changes are allowed (diffAttributes will splice).
    return o.tagName === m.tagName;
  }
  // Texts + comments correlate if same nodeName — text-replace can adjust.
  return true;
}

/**
 * Given an origIdx→mutIdx alignment, recurse into correlated pairs (so
 * they get attribute/text/children splices as usual) and emit
 * children-insert splices for the unmapped mutated children.
 */
function applyAlignment(
  mapping: number[],
  origKids: AnyNode[],
  mutKids: AnyNode[],
  src: string,
  out: Splice[],
  parent: Element | Frag,
): void {
  // Recurse into mapped pairs.
  for (let i = 0; i < mapping.length; i++) {
    walkNode(origKids[i]!, mutKids[mapping[i]!]!, src, out);
  }
  // Emit children-insert splices for the gaps. A "gap" is a contiguous run
  // of unmapped mutKid indices. Each gap is inserted at:
  //   - just before the mapped origKid that follows it (if any), or
  //   - just before parent's endTag (if gap is at the tail)
  const mapped = new Set(mapping);
  let i = 0;
  while (i < mutKids.length) {
    if (mapped.has(i)) {
      i++;
      continue;
    }
    // Collect contiguous unmapped run.
    const runStart = i;
    while (i < mutKids.length && !mapped.has(i)) i++;
    const runEnd = i; // exclusive
    const runNodes = mutKids.slice(runStart, runEnd);

    // Pick insertion offset in src.
    let insertAt: number;
    if (runEnd < mutKids.length) {
      // Insert before the mapped original that corresponds to mutKid[runEnd].
      const nextOrigIdx = mapping.indexOf(runEnd);
      if (nextOrigIdx < 0) {
        throw new UnsupportedMutationError(
          'Alignment bookkeeping error',
          'unsupported-mutation',
        );
      }
      const anchorNode = origKids[nextOrigIdx]!;
      const anchorStart = nodeStartOffset(anchorNode);
      if (anchorStart === null) {
        throw new UnsupportedMutationError(
          'Cannot locate insertion anchor (no source location on anchor node)',
          'no-source-location',
        );
      }
      insertAt = anchorStart;
    } else {
      // Run is at the tail — insert just before the parent's closing tag
      // (or end of content for a fragment).
      insertAt = tailInsertOffset(parent, src);
      if (insertAt < 0) {
        throw new UnsupportedMutationError(
          'Cannot locate tail insertion point (parent lacks endTag)',
          'no-source-location',
        );
      }
    }

    out.push({
      kind: 'children-insert',
      start: insertAt,
      end: insertAt,
      replacement: serializeNodes(runNodes),
    });
  }
}

/**
 * Detect the simple wrapping case: one original child, one mutated child,
 * where the mutated child is an element whose subtree *contains* a
 * structural equivalent of the original child and whose extra content is
 * all new.
 *
 * We don't recurse splices into the moved original — we just rewrite the
 * whole original node range with the serialized wrapper. That's byte-lossy
 * for the inner original content (it gets re-serialized) but we only take
 * this path when children-insert alignment failed, so it's the best option
 * short of the full re-serialization fallback.
 */
function tryElementWrap(
  orig: AnyNode,
  mut: AnyNode,
  _src: string,
): Splice | null {
  void _src;
  if (!isElement(mut)) return null;
  // Does the mutated subtree contain a node structurally equivalent to orig?
  if (!subtreeContains(mut, orig)) return null;
  const origStart = nodeStartOffset(orig);
  const origEnd = nodeEndOffset(orig);
  if (origStart === null || origEnd === null) return null;
  return {
    kind: 'element-wrap',
    start: origStart,
    end: origEnd,
    replacement: serializeNode(mut),
  };
}

function subtreeContains(haystack: Element, needle: AnyNode): boolean {
  for (const child of haystack.childNodes) {
    if (nodesCouldCorrelate(child, needle)) return true;
    if (isElement(child) && subtreeContains(child, needle)) return true;
  }
  return false;
}

function nodeStartOffset(n: AnyNode): number | null {
  const loc = (n as { sourceCodeLocation?: { startOffset?: number } }).sourceCodeLocation;
  return typeof loc?.startOffset === 'number' ? loc.startOffset : null;
}

function nodeEndOffset(n: AnyNode): number | null {
  const loc = (n as { sourceCodeLocation?: { endOffset?: number } }).sourceCodeLocation;
  return typeof loc?.endOffset === 'number' ? loc.endOffset : null;
}

function tailInsertOffset(parent: Element | Frag, src: string): number {
  const el = parent as Element;
  const loc = (el as { sourceCodeLocation?: { endTag?: { startOffset?: number } } })
    .sourceCodeLocation;
  if (loc?.endTag?.startOffset !== undefined) return loc.endTag.startOffset;
  // Document fragment — tail is the end of the original source.
  return src.length;
}

function serializeNodes(nodes: AnyNode[]): string {
  return nodes.map(serializeNode).join('');
}

function serializeNode(n: AnyNode): string {
  // parse5's serialize() takes a parent. Wrap the single node in a fake
  // fragment so the serializer renders it directly.
  const fakeFrag = {
    nodeName: '#document-fragment',
    childNodes: [n],
  } as unknown as Frag;
  return serialize(fakeFrag);
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
    // v2: if the "tag change" is actually a wrap (e.g. <img> → <figure><img>…</figure>),
    // handle it with element-wrap before the (stricter) tag-rename path.
    const wrap = tryElementWrap(o, m, src);
    if (wrap) {
      out.push(wrap);
      return;
    }
    replaceElementTag(o, m, src, out);
    walk(o.childNodes, m.childNodes, src, out, o);
    return;
  }
  if (isElement(o) && isElement(m)) {
    diffAttributes(o, m, src, out);
    walk(o.childNodes, m.childNodes, src, out, o);
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
