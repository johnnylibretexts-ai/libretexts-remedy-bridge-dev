/**
 * ChartDescriber — vision-model driven chart/diagram accessibility.
 *
 * Borrows the "describe + data-table equivalent" idea from the sibling
 * project-remedy-server `vision.py`. We ask for a JSON object containing
 * alt text, a ~200-word long description, and (when feasible) an HTML
 * <table> transcribing the chart's underlying data. The table is surfaced
 * behind a <details> disclosure so sighted users aren't interrupted but
 * screen-reader users get a structured equivalent.
 */
import { LLMClient, imageSourceFromUrl } from './llm-client.js';

export interface ChartDescription {
  /** Concise, under 150 chars. No "image of" prefix. */
  altText: string;
  /** ~200-word plain-text paragraph summarizing the chart's story. */
  longDescription: string;
  /** HTML <table> transcribing chart data, or undefined if not tabular. */
  dataTable?: string;
}

export interface ChartDescribeOptions {
  client?: LLMClient;
  altMaxLength?: number;
  longMaxWords?: number;
}

const PROMPT = `You are writing accessibility content for a chart, graph, or diagram in a textbook.

Return a single JSON object (no surrounding prose, no markdown fences) with exactly these keys:

{
  "altText": string,           // concise summary, under 150 characters, no "image of" / "picture of" prefix
  "longDescription": string,   // plain-text paragraph under 250 words describing the chart's overall story,
                               //  trends, comparisons, and notable values. No HTML, no markdown.
  "dataTable": string | null   // a valid HTML <table> transcribing the chart's data, or null if the
                               //  chart is purely schematic / illustrative with no discrete data to transcribe
}

Rules for dataTable:
- If the chart has readable discrete values (bar/column/line/pie with visible labels or legend), produce
  a <table> with a <caption> element, a <thead> whose <th> cells use scope="col", and a <tbody>.
- If grouping or row headers are implied, use <th scope="row"> for row headers.
- Do NOT use markdown. Only valid HTML element names and attributes. No inline styles.
- If the chart is a schematic diagram (flow, cycle, anatomy, circuit) with no numeric data, set dataTable to null.

Rules for longDescription:
- Plain text only. No HTML tags, no markdown, no lists.
- Describe axes, units, the overall trend, and any noteworthy extrema or comparisons.
- Under 250 words.

Rules for altText:
- Under 150 characters.
- Describe what the chart conveys, not what it looks like.
- No "image of" / "picture of" prefix.

Output only the JSON object.`;

export class ChartDescriber {
  private client: LLMClient;
  private altMaxLength: number;
  private longMaxWords: number;

  constructor(opts: ChartDescribeOptions = {}) {
    this.client = opts.client ?? new LLMClient();
    this.altMaxLength = opts.altMaxLength ?? 150;
    this.longMaxWords = opts.longMaxWords ?? 250;
  }

  async describeAsTable(imageUrl: string, context?: string): Promise<ChartDescription> {
    const image = await imageSourceFromUrl(imageUrl);
    const prompt = context
      ? `${PROMPT}\n\nSurrounding page context (may help disambiguate axes/units): ${context.slice(0, 800)}`
      : PROMPT;
    const raw = await this.client.vision({ image, prompt, maxTokens: 2048, temperature: 0.2 });
    const parsed = parseJsonLoose(raw);
    if (!parsed) throw new Error('ChartDescriber: could not parse JSON from model output.');

    const altText = sanitizeAlt(
      typeof parsed.altText === 'string' ? parsed.altText : '',
      this.altMaxLength,
    );
    const longDescription = sanitizeLong(
      typeof parsed.longDescription === 'string' ? parsed.longDescription : '',
      this.longMaxWords,
    );
    const dataTable = sanitizeTable(parsed.dataTable);

    if (!altText) throw new Error('ChartDescriber: model returned empty altText.');
    if (!longDescription) throw new Error('ChartDescriber: model returned empty longDescription.');

    const result: ChartDescription = { altText, longDescription };
    if (dataTable) result.dataTable = dataTable;
    return result;
  }
}

/**
 * Extract the first JSON object from model output, tolerating leading/trailing
 * prose or code fences. Returns `null` if no object can be parsed.
 */
function parseJsonLoose(text: string): Record<string, unknown> | null {
  const stripped = text
    .trim()
    // strip ```json ... ``` or ``` ... ``` fences
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(stripped);
  if (direct) return direct;
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  return tryParse(stripped.slice(first, last + 1));
}

function sanitizeAlt(s: string, max: number): string {
  const cleaned = s
    .replace(/^["']|["']$/g, '')
    .replace(/^(image|picture|photo) of\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.length > max ? cleaned.slice(0, max - 1).trimEnd() + '…' : cleaned;
}

function sanitizeLong(s: string, maxWords: number): string {
  // Strip any HTML tags the model slipped in.
  const noHtml = s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (!noHtml) return '';
  const words = noHtml.split(' ');
  if (words.length <= maxWords) return noHtml;
  return words.slice(0, maxWords).join(' ').trimEnd() + '…';
}

function sanitizeTable(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  if (!trimmed) return undefined;
  if (/^null$/i.test(trimmed)) return undefined;
  // Must start with a <table ...> tag; otherwise reject.
  if (!/^<table[\s>]/i.test(trimmed)) return undefined;
  if (!/<\/table>\s*$/i.test(trimmed)) return undefined;
  return trimmed;
}
