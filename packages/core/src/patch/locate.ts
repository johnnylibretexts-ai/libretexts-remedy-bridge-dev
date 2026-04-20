import { parseFragment } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';

export type ParsedFragment = DefaultTreeAdapterMap['documentFragment'];

/**
 * Parse an HTML fragment and attach source-code locations to every node
 * that the parser saw in the input. Nodes inserted by the parser algorithm
 * (implicit <tbody>, etc.) have `sourceCodeLocation: null` — the differ
 * must treat those as out-of-scope when splicing.
 */
export function parseWithLocations(source: string): ParsedFragment {
  return parseFragment(source, { sourceCodeLocationInfo: true });
}
