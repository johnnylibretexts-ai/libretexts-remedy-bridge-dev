import { LLMClient } from './llm-client.js';

/**
 * Ask the LLM to classify each header cell in a table as `scope="col"` or
 * `scope="row"`. Mirrors the `_fix_missing_scope` prompt in
 * project-remedy-server's TableRemediation — see
 * `accessibility_strategies.py` — but ported to TypeScript and returned
 * as a structured map for the caller to apply.
 *
 * Caller is responsible for positional fallback when the LLM is unavailable
 * or the response omits a given header.
 */
export async function inferHeaderScopes(
  tableHtml: string,
  headers: string[],
  client?: LLMClient,
): Promise<Record<string, 'col' | 'row'>> {
  const cleanHeaders = headers.map((h) => h.trim()).filter(Boolean);
  if (cleanHeaders.length === 0) return {};

  const llm = client ?? tryMakeClient();
  if (!llm) return {};

  const headerList = cleanHeaders.map((t) => `"${t}"`).join(', ');
  const truncated = tableHtml.length > 4000 ? `${tableHtml.slice(0, 4000)}\n... [truncated]` : tableHtml;
  const prompt =
    `Analyze this HTML table and determine scope='col' or scope='row' for each header cell (<th>).\n\n` +
    `Headers: ${headerList}\n\n` +
    `Table HTML:\n${truncated}\n\n` +
    `Respond ONLY with a JSON object mapping header text to 'col' or 'row'. ` +
    `Example: {"Name": "col", "Category": "row"}`;

  // One retry for scope inference — the JSON-only constraint sometimes needs a nudge.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await llm.chat({
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 800,
        temperature: 0.1,
      });
      const parsed = parseScopeJson(raw);
      if (Object.keys(parsed).length > 0) return parsed;
    } catch (err) {
      if (process.env.DEBUG) console.error('inferHeaderScopes attempt failed:', err);
    }
  }
  return {};
}

/**
 * Turn a header cell's text into a stable `id="th-{slug}"` value.
 *
 * Matches the shape used in `_fix_header_ids` in accessibility_strategies.py:
 * lowercase, non-alphanumeric → `-`, capped at 20 chars, fall back to
 * `header-{idx+1}` when empty or leading non-alpha.
 */
export function slugifyHeaderId(text: string, idx: number): string {
  const lowered = text.trim().toLowerCase();
  if (!lowered) return `th-${idx + 1}`;
  let slug = lowered.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20);
  if (!slug || !/^[a-z]/.test(slug)) slug = `header-${idx + 1}`;
  return `th-${slug}`;
}

function parseScopeJson(raw: string): Record<string, 'col' | 'row'> {
  if (!raw) return {};
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const out: Record<string, 'col' | 'row'> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        const norm = v.trim().toLowerCase();
        if (norm === 'col' || norm === 'row') out[k] = norm;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function tryMakeClient(): LLMClient | undefined {
  try {
    return new LLMClient();
  } catch {
    return undefined;
  }
}
