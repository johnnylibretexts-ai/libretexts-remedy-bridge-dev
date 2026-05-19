import { LLMClient, type ImageSource, imageSourceFromUrl } from './llm-client.js';

export interface AltTextOptions {
  client?: LLMClient;
  maxLength?: number;
  consumeLlmCall?: () => boolean;
}

export interface GenerateAltTextOptions {
  existingAlt?: string;
  pageContext?: string;
  caption?: string;
}

const PROMPT = `You are writing an accessibility alt attribute for an image in a textbook.

Requirements:
- Describe what the image conveys, not what it looks like.
- One concise sentence under {MAX} characters.
- Do NOT start with "Image of" or "Picture of".
- Include essential text content if present (labels, axis names, key values).
- For charts/diagrams, state the relationship or trend being shown.
- Do not simply truncate existing alt text; write a complete, useful replacement.
- Plain text only. No markdown, no quotes around the output.

Output only the alt text.`;

const RETRY_PROMPT = `Rewrite this image alt text so it is complete, accurate, and under {MAX} characters.
Do not use an ellipsis. Do not start with "Image of" or "Picture of".

Candidate alt text:
{ALT}

Output only the rewritten alt text.`;

export class AltTextGenerator {
  private client: LLMClient;
  private maxLength: number;
  private consumeLlmCall?: () => boolean;

  constructor(opts: AltTextOptions = {}) {
    this.client = opts.client ?? new LLMClient();
    this.maxLength = opts.maxLength ?? 150;
    this.consumeLlmCall = opts.consumeLlmCall;
  }

  async generate(imageUrl: string, contextOrOptions?: string | GenerateAltTextOptions): Promise<string> {
    const image = await imageSourceFromUrl(imageUrl);
    const options = typeof contextOrOptions === 'string'
      ? { pageContext: contextOrOptions }
      : (contextOrOptions ?? {});
    const prompt = buildPrompt(this.maxLength, options);
    const raw = await this.vision(image, prompt, 256);
    const cleaned = cleanAlt(raw);
    if (isAcceptableAlt(cleaned, this.maxLength)) return cleaned;
    if (!cleaned) throw new Error('LLM returned empty alt text.');

    const retryPrompt = RETRY_PROMPT
      .replaceAll('{MAX}', String(this.maxLength))
      .replace('{ALT}', cleaned);
    const retryRaw = await this.vision(image, retryPrompt, 120);
    const retry = cleanAlt(retryRaw);
    if (isAcceptableAlt(retry, this.maxLength)) return retry;
    if (!retry) throw new Error('LLM returned empty alt text.');
    throw new Error(`LLM alt text exceeded ${this.maxLength} characters.`);
  }

  private async vision(image: ImageSource, prompt: string, maxTokens: number): Promise<string> {
    if (this.consumeLlmCall && !this.consumeLlmCall()) {
      throw new Error('LLM budget exhausted.');
    }
    return this.client.vision({ image, prompt, maxTokens, temperature: 0.2 });
  }
}

function buildPrompt(maxLength: number, options: GenerateAltTextOptions): string {
  const sections: string[] = [PROMPT.replaceAll('{MAX}', String(maxLength))];
  if (options.existingAlt?.trim()) {
    sections.push(`Existing alt text to improve:\n${options.existingAlt.trim().slice(0, 600)}`);
  }
  if (options.caption?.trim()) {
    sections.push(`Nearby caption:\n${options.caption.trim().slice(0, 400)}`);
  }
  if (options.pageContext?.trim()) {
    sections.push(`Page context:\n${options.pageContext.trim().slice(0, 700)}`);
  }
  return sections.join('\n\n');
}

export function cleanAlt(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ');
}

export function isAcceptableAlt(alt: string, maxLength = 150): boolean {
  if (!alt) return false;
  if (alt.length > maxLength) return false;
  if (alt.includes('…') || alt.endsWith('...')) return false;
  if (/^(image|picture|photo|graphic)\s+of\b/i.test(alt)) return false;
  return true;
}
