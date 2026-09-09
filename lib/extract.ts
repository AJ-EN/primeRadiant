import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  ExtractionSchema,
  MAX_TOKENS,
  MODEL,
  SYSTEM,
  interpretExtraction,
  salvageJson,
  type Interpretation,
} from './parse';

/**
 * The one call that costs money.
 *
 * Lives here rather than in the route so the eval suite exercises the exact production path
 * instead of a copy of it. A smoke test against a reimplementation proves nothing.
 */
export async function extractFromSentence(sentence: string): Promise<Interpretation> {
  const client = new Anthropic();

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    messages: [{ role: 'user', content: sentence }],
    output_config: { format: zodOutputFormat(ExtractionSchema) },
  });

  let raw: unknown = response.parsed_output;
  if (!raw) {
    // Structured output should always populate parsed_output. If it did not, the most likely
    // cause is truncation at max_tokens, so try the raw text before giving up.
    const text = response.content.find((b) => b.type === 'text');
    raw = text ? salvageJson(text.text) : null;
  }

  return interpretExtraction(raw);
}
