/**
 * LLM Module Exports
 */

import type { LLMClient } from './types';
import { OllamaClient } from './ollama';
import { TogetherClient } from './together';

export type { LLMClient, CompletionOptions } from './types';
export { OllamaClient } from './ollama';
export { TogetherClient } from './together';

/**
 * Create the appropriate LLM client based on environment.
 *
 * - If TOGETHER_API_KEY is set → TogetherClient (production)
 * - Otherwise → OllamaClient (local development)
 */
export function createLLMClient(): LLMClient {
  if (process.env.TOGETHER_API_KEY) {
    return new TogetherClient();
  }
  return new OllamaClient();
}
