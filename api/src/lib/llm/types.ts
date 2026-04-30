/**
 * LLM Client Interface
 * 
 * Abstraction for LLM providers (Ollama, Together.ai, etc.)
 * Allows swapping providers without changing parser code.
 */

/**
 * Options for LLM completion requests
 */
export interface CompletionOptions {
  temperature?: number; // 0.0-1.0, lower = more deterministic
  maxTokens?: number; // Maximum tokens to generate
  signal?: AbortSignal;
}

export type LLMFailureKind = 'auth' | 'rate_limit' | 'network' | 'timeout' | 'model' | 'provider';

export class LLMProviderError extends Error {
  readonly provider: string;
  readonly model: string;
  readonly kind: LLMFailureKind;
  readonly statusCode?: number;
  readonly retryAfter?: string;

  constructor(
    message: string,
    options: {
      provider: string;
      model: string;
      kind: LLMFailureKind;
      statusCode?: number;
      retryAfter?: string;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = 'LLMProviderError';
    this.provider = options.provider;
    this.model = options.model;
    this.kind = options.kind;
    this.statusCode = options.statusCode;
    this.retryAfter = options.retryAfter;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/**
 * LLM client interface
 * 
 * Implementations: OllamaClient, TogetherClient, etc.
 */
export interface LLMClient {
  readonly providerName?: string;
  readonly modelName?: string;

  /**
   * Complete a prompt and return the response
   * 
   * @param prompt - The prompt to send to the LLM
   * @param options - Optional completion parameters
   * @returns The LLM's response text
   * @throws Error if the LLM request fails
   */
  complete(prompt: string, options?: CompletionOptions): Promise<string>;
}
