import type { HandlerFn } from './types.js';

/**
 * Mark an image decorative: empty alt + role="presentation".
 *
 * Screen readers skip these entirely. Use when the planner is confident
 * the image carries no informational value (spacer, flourish, purely
 * ornamental icon).
 *
 * No LLM call.
 */
export const decorativeMark: HandlerFn = async (img) => {
  img.setAttribute('alt', '');
  img.setAttribute('role', 'presentation');
  return {
    ok: true,
    mutation: 'marked decorative (alt="", role="presentation")',
  };
};
