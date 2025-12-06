/**
 * Ollama LLM Client
 * 
 * Implementation of LLMClient for local Ollama instances.
 * Default: http://localhost:11434 with qwen2.5:7b model
 */

import type { LLMClient, CompletionOptions } from './types';

/**
 * Ollama API client
 * 
 * Connects to a local Ollama instance running on localhost:11434
 */
export class OllamaClient implements LLMClient {
  constructor(
    private baseUrl: string = process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    private model: string = process.env.OLLAMA_MODEL || 'qwen2.5:7b'
  ) {}

  /**
   * Complete a prompt using Ollama
   */
  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          options: {
            temperature: options?.temperature ?? 0.1, // Low temperature for structured output
            num_predict: options?.maxTokens ?? 2000, // Enough for JSON responses
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Ollama API error (${response.status}): ${errorText}`
        );
      }

      const data = (await response.json()) as { response: string; done: boolean };
      
      if (!data.done) {
        throw new Error('Ollama response incomplete');
      }

      return data.response;
    } catch (error) {
      if (error instanceof Error) {
        // Check if it's a connection error
        if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
          throw new Error(
            `Cannot connect to Ollama at ${this.baseUrl}. Is Ollama running?`
          );
        }
        throw error;
      }
      throw new Error('Unknown error calling Ollama');
    }
  }

  /**
   * Check if Ollama is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

