/**
 * Together.ai LLM Client
 *
 * OpenAI-compatible implementation for production deployments.
 * Uses Together.ai's inference API with models like Qwen, Llama, Mixtral.
 *
 * Requires TOGETHER_API_KEY env var.
 * Optional: TOGETHER_MODEL (default: Qwen/Qwen2.5-7B-Instruct)
 * Optional: TOGETHER_TIMEOUT_MS (default: 30000)
 */

import { LLMProviderError, type LLMClient, type CompletionOptions } from './types';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MODEL = 'Qwen/Qwen2.5-7B-Instruct';

interface TogetherChoice {
  message: { role: string; content: string };
  finish_reason: string;
}

interface TogetherResponse {
  choices: TogetherChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface TogetherErrorBody {
  error?: { message: string; type: string };
}

export class TogetherClient implements LLMClient {
  readonly providerName = 'together';
  private apiKey: string;
  readonly modelName: string;
  private timeoutMs: number;
  private baseUrl: string;

  constructor(options?: {
    apiKey?: string;
    model?: string;
    timeoutMs?: number;
    baseUrl?: string;
  }) {
    this.apiKey = options?.apiKey ?? process.env.TOGETHER_API_KEY ?? '';
    this.modelName = options?.model ?? process.env.TOGETHER_MODEL ?? DEFAULT_MODEL;
    this.timeoutMs = options?.timeoutMs ?? (Number(process.env.TOGETHER_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
    this.baseUrl = options?.baseUrl ?? 'https://api.together.xyz/v1';

    if (!this.apiKey) {
      throw new Error(
        'Together.ai API key is required. Set TOGETHER_API_KEY env var or pass apiKey option.'
      );
    }
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    const abortFromCaller = () => controller.abort();
    if (options?.signal?.aborted) {
      controller.abort();
    } else {
      options?.signal?.addEventListener('abort', abortFromCaller, { once: true });
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelName,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: options?.temperature ?? 0.1,
          max_tokens: options?.maxTokens ?? 2000,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorDetail = `${response.status} ${response.statusText}`;
        try {
          const body = (await response.json()) as TogetherErrorBody;
          if (body.error?.message) {
            errorDetail = body.error.message;
          }
        } catch {
          // Ignore parse failures on error bodies
        }

        if (response.status === 401 || response.status === 403) {
          throw new LLMProviderError('LLM authentication failure', {
            provider: this.providerName,
            model: this.modelName,
            kind: 'auth',
            statusCode: response.status,
          });
        }
        if (response.status === 429) {
          throw new LLMProviderError('LLM provider rate limit exceeded', {
            provider: this.providerName,
            model: this.modelName,
            kind: 'rate_limit',
            statusCode: response.status,
            retryAfter: response.headers.get('retry-after') ?? undefined,
          });
        }

        throw new LLMProviderError(`Together.ai API error: ${errorDetail}`, {
          provider: this.providerName,
          model: this.modelName,
          kind: 'provider',
          statusCode: response.status,
        });
      }

      const data = (await response.json()) as TogetherResponse;
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('Together.ai returned empty response');
      }

      return content;
    } catch (error) {
      if (error instanceof Error) {
        if (error instanceof LLMProviderError) {
          throw error;
        }
        if (error.name === 'AbortError') {
          throw new LLMProviderError(
            `Together.ai request timed out after ${this.timeoutMs}ms`,
            {
              provider: this.providerName,
              model: this.modelName,
              kind: 'timeout',
              cause: error,
            }
          );
        }
        if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
          throw new LLMProviderError('Cannot connect to Together.ai API. Check network connectivity.', {
            provider: this.providerName,
            model: this.modelName,
            kind: 'network',
            cause: error,
          });
        }
        throw error;
      }
      throw new LLMProviderError('Unknown error calling Together.ai', {
        provider: this.providerName,
        model: this.modelName,
        kind: 'provider',
      });
    } finally {
      clearTimeout(timeoutId);
      options?.signal?.removeEventListener('abort', abortFromCaller);
    }
  }
}
