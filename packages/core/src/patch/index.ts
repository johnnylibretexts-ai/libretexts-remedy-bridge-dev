import { parseFragment } from 'parse5';
import { parseWithLocations } from './locate.js';
import { diffTrees } from './diff.js';
import { applySplices } from './apply.js';
import { structurallyEquivalent } from './verify.js';
import { UnsupportedMutationError } from './types.js';
import type { PatchResult } from './types.js';

export type { Splice, PatchResult, FallbackReason } from './types.js';

export function bytePreservePatch(
  originalSource: string,
  mutatedSource: string,
): PatchResult {
  let origTree;
  let mutTree;
  try {
    origTree = parseWithLocations(originalSource);
    mutTree = parseFragment(mutatedSource);
  } catch (err) {
    return {
      ok: false,
      splices: [],
      reason: 'parse-error',
      note: err instanceof Error ? err.message : String(err),
    };
  }

  let splices;
  try {
    splices = diffTrees(origTree, mutTree, originalSource);
  } catch (err) {
    if (err instanceof UnsupportedMutationError) {
      return { ok: false, splices: [], reason: err.reason, note: err.message };
    }
    throw err;
  }

  const patched = applySplices(originalSource, splices);

  const roundtrip = parseFragment(patched);
  const v = structurallyEquivalent(roundtrip, mutTree);
  if (!v.ok) {
    return {
      ok: false,
      splices: [],
      reason: 'verification-mismatch',
      note: v.note,
    };
  }

  return { ok: true, bytes: patched, splices };
}
