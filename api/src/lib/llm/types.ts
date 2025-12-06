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
}

/**
 * LLM client interface
 * 
 * Implementations: OllamaClient, TogetherClient, etc.
 */
export interface LLMClient {
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

