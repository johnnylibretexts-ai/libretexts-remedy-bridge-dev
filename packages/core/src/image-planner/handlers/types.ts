import type { LLMClient } from '../../ai/llm-client.js';

/** Runtime context a handler needs to mutate the DOM and (optionally) call an LLM. */
export interface HandlerContext {
  /** Document to mutate (source of `createElement`, parent lookup). */
  doc: Document;
  /** LLM client — required by handlers that call vision; optional for decorative/etc. */
  llm?: LLMClient;
  /** Absolute URL of the image (caller has already resolved host/relative refs). */
  absoluteSrc: string;
  /** Short page-context excerpt the handler may pass into prompts. */
  pageContext?: string;
}

export interface HandlerResult {
  ok: boolean;
  /** Short human-readable description of what was mutated, for the strategy report. */
  mutation?: string;
  /** Diagnostic when `ok` is false. */
  error?: string;
  /** True if the handler made an LLM call the caller should count against budget. */
  llmCall?: boolean;
}

export type HandlerFn = (
  img: HTMLImageElement,
  ctx: HandlerContext,
) => Promise<HandlerResult>;
