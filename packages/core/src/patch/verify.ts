import type { DefaultTreeAdapterMap } from 'parse5';

type Frag = DefaultTreeAdapterMap['documentFragment'];
type AnyNode = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type TextNode = DefaultTreeAdapterMap['textNode'];

export interface VerifyResult {
  ok: boolean;
  note?: string;
}

export function structurallyEquivalent(a: Frag, b: Frag): VerifyResult {
  return cmpChildren(a.childNodes, b.childNodes, 'fragment');
}

function cmpChildren(a: AnyNode[], b: AnyNode[], path: string): VerifyResult {
  if (a.length !== b.length) {
    return { ok: false, note: `child count mismatch at ${path}: ${a.length} vs ${b.length}` };
  }
  for (let i = 0; i < a.length; i++) {
    const r = cmpNode(a[i]!, b[i]!, `${path}>${i}`);
    if (!r.ok) return r;
  }
  return { ok: true };
}

function cmpNode(a: AnyNode, b: AnyNode, path: string): VerifyResult {
  if (a.nodeName !== b.nodeName) {
    return { ok: false, note: `tag mismatch at ${path}: ${a.nodeName} vs ${b.nodeName}` };
  }
  if (a.nodeName === '#text') {
    const av = (a as TextNode).value;
    const bv = (b as TextNode).value;
    if (av !== bv) return { ok: false, note: `text mismatch at ${path}` };
    return { ok: true };
  }
  if (a.nodeName === '#comment') return { ok: true };
  const ea = a as Element;
  const eb = b as Element;
  const as = new Set(ea.attrs.map((x) => `${x.name}=${x.value}`));
  const bs = new Set(eb.attrs.map((x) => `${x.name}=${x.value}`));
  if (as.size !== bs.size) {
    return { ok: false, note: `attr count mismatch at ${path}` };
  }
  for (const entry of as) {
    if (!bs.has(entry)) return { ok: false, note: `attr mismatch at ${path}: ${entry}` };
  }
  return cmpChildren(ea.childNodes, eb.childNodes, path);
}
