import { LLMClient } from './llm-client.js';

export interface FormFieldContext {
  name?: string;
  placeholder?: string;
  type?: string;
  surroundingText?: string;
}

/**
 * Suggest a short visible label (2-5 words) for an unlabeled form field.
 *
 * Calls the LLM once — no retries — and falls back to a deterministic
 * humanization of the field `name` or `placeholder` when the LLM is
 * unavailable or errors.
 */
export async function inferFormLabel(field: FormFieldContext, client?: LLMClient): Promise<string> {
  const fallback = deriveFallbackLabel(field);
  const llm = client ?? tryMakeClient();
  if (!llm) return fallback;

  const details = {
    name: field.name ?? null,
    placeholder: field.placeholder ?? null,
    type: field.type ?? null,
    surroundingText: field.surroundingText ? field.surroundingText.trim().slice(0, 240) : null,
  };

  const prompt =
    `Suggest a short (2-5 words) visible label for this form field. ` +
    `Field details: ${JSON.stringify(details)}. ` +
    `Respond with only the label text — no quotes, no explanation.`;

  try {
    const raw = await llm.chat({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 32,
      temperature: 0.2,
    });
    const cleaned = cleanLabel(raw);
    return cleaned || fallback;
  } catch (err) {
    if (process.env.DEBUG) console.error('inferFormLabel failed:', err);
    return fallback;
  }
}

/**
 * Derive a reasonable label from `name` or `placeholder` when we cannot
 * reach the LLM. Splits camelCase / snake_case / kebab-case and title-cases.
 */
export function deriveFallbackLabel(field: FormFieldContext): string {
  const source = field.placeholder?.trim() || field.name?.trim() || '';
  if (!source) return 'Field';
  if (field.placeholder && field.placeholder.trim()) return field.placeholder.trim();
  return humanize(source);
}

function humanize(raw: string): string {
  // Insert space between camelCase, normalize separators, collapse whitespace
  const spaced = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!spaced) return 'Field';
  return spaced
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

function cleanLabel(raw: string): string {
  if (!raw) return '';
  const firstLine = raw.split(/\r?\n/)[0] ?? '';
  return firstLine
    .replace(/^["'`]|["'`]$/g, '')
    .replace(/^\s*(?:label[:\-]\s*)/i, '')
    .replace(/[.!?,;:]+$/g, '')
    .trim()
    .slice(0, 80);
}

function tryMakeClient(): LLMClient | undefined {
  try {
    return new LLMClient();
  } catch {
    return undefined;
  }
}
