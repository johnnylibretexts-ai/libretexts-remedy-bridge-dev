import { LLMClient, imageSourceFromUrl } from './llm-client.js';

export interface AltTextOptions {
  client?: LLMClient;
  maxLength?: number;
}

const PROMPT = `You are writing an accessibility alt attribute for an image in a textbook.

Requirements:
- Describe what the image conveys, not what it looks like.
- 1-2 sentences, concise. Aim for under 150 characters.
- Do NOT start with "Image of" or "Picture of".
- Include essential text content if present (labels, axis names, key values).
- For charts/diagrams, state the relationship or trend being shown.
- Plain text only. No markdown, no quotes around the output.

Output only the alt text.`;

export class AltTextGenerator {
  private client: LLMClient;
  private maxLength: number;

  constructor(opts: AltTextOptions = {}) {
    this.client = opts.client ?? new LLMClient();
    this.maxLength = opts.maxLength ?? 150;
  }

  async generate(imageUrl: string, context?: string): Promise<string> {
    const image = await imageSourceFromUrl(imageUrl);
    const prompt = context ? `${PROMPT}\n\nPage context: ${context.slice(0, 500)}` : PROMPT;
    const raw = await this.client.vision({ image, prompt, maxTokens: 256 });
    const cleaned = raw.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ');
    if (!cleaned) throw new Error('LLM returned empty alt text.');
    return cleaned.length > this.maxLength ? cleaned.slice(0, this.maxLength - 1).trimEnd() + '…' : cleaned;
  }
}
