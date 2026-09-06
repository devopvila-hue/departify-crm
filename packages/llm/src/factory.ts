/**
 * Factory: build an LlmClient from a flat config object.
 *
 * The rest of the CRM never sees a concrete provider — it asks for
 * `createLlmClient({ provider: 'anthropic', … })` and gets back the
 * same `LlmClient` interface regardless of which vendor answers.
 *
 * Configuration knobs:
 *  - provider:        'anthropic' today, 'openai' later
 *  - apiKey:          required
 *  - baseUrl:         optional (defaults to vendor's standard URL)
 *  - model:           optional default; the request can override
 *  - timeoutMs:       default 60_000
 *  - maxRetries:      default 2
 */
import type { LlmClient } from './client.js';
import { AnthropicProvider, type AnthropicProviderConfig } from './anthropic.js';

export type LlmProviderId = 'anthropic' | 'openai';

export interface CreateLlmClientConfig {
  provider: LlmProviderId;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export function createLlmClient(config: CreateLlmClientConfig): LlmClient {
  switch (config.provider) {
    case 'anthropic': {
      const opts: AnthropicProviderConfig = {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        defaultModel: config.model,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
      };
      return new AnthropicProvider(opts);
    }
    case 'openai':
      throw new Error("'openai' provider is not implemented in Sprint 6 — use 'anthropic' (works with MiniMax via base URL)");
  }
}
