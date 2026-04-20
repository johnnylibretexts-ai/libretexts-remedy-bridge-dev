/**
 * A single byte-range replacement against the original source string.
 * Offsets are zero-based; `end` is exclusive.
 */
export interface Splice {
  start: number;
  end: number;
  replacement: string;
  /** Debug label — which differ case emitted this splice. */
  kind:
    | 'attr-change'
    | 'attr-insert'
    | 'attr-unset'
    | 'text-replace'
    | 'start-tag-replace'
    | 'end-tag-replace';
}

export type FallbackReason =
  | 'unsupported-mutation'
  | 'no-source-location'
  | 'verification-mismatch'
  | 'parse-error';

export interface PatchResult {
  ok: boolean;
  /** Patched bytes when ok; undefined when not-ok (caller falls back). */
  bytes?: string;
  splices: Splice[];
  reason?: FallbackReason;
  /** Human-readable detail, appended to audit log notes. */
  note?: string;
}

/**
 * Internal signal thrown by the differ when it detects an in-scope-v1
 * boundary. `bytePreservePatch` catches and converts to a PatchResult.
 */
export class UnsupportedMutationError extends Error {
  constructor(
    message: string,
    readonly reason: FallbackReason,
  ) {
    super(message);
    this.name = 'UnsupportedMutationError';
  }
}
