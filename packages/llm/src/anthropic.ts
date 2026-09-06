/**
 * Anthropic-compatible provider. Works against the real Anthropic API
 * and against MiniMax / any other provider that exposes the same
 * Messages endpoint at a custom base URL.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { LlmMessage, LlmRequest, LlmResponse, ContentBlock, ToolUseBlock, ToolResultBlock, TextBlock } from './types.js';
import { LlmError } from './errors.js';

export interface AnthropicProviderConfig {
  apiKey: string;
  /** e.g. https://api.anthropic.com  ·  https://api.minimax.io/v1 */
  baseUrl?: string;
  /** Optional default model. The request can override. */
  defaultModel?: string;
  /** Max wall time per request. Default 60s. */
  timeoutMs?: number;
  /** Max retries with exponential backoff for transient errors. */
  maxRetries?: number;
}

export class AnthropicProvider {
  private readonly client: Anthropic;
  private readonly defaultModel?: string;
  private readonly maxRetries: number;

  constructor(config: AnthropicProviderConfig) {
    if (!config.apiKey) {
      throw new LlmError('auth_failed', 'AnthropicProvider requires apiKey', { status: 401 });
    }
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeoutMs ?? 60_000,
      maxRetries: 0, // we handle retries ourselves for clarity
    });
    this.defaultModel = config.defaultModel;
    this.maxRetries = config.maxRetries ?? 2;
  }

  async chat(req: LlmRequest): Promise<LlmResponse> {
    const model = req.model || this.defaultModel;
    if (!model) {
      throw new LlmError('invalid_request', 'LlmRequest.model is required (or set AnthropicProvider.defaultModel)');
    }
    const messages = toAnthropicMessages(req.messages);
    const tools = req.tools?.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Tool.InputSchema }));

    const attempt = async (): Promise<LlmResponse> => {
      try {
        const params: Anthropic.MessageCreateParamsNonStreaming = {
          model,
          max_tokens: req.max_tokens,
          temperature: req.temperature,
          system: req.system,
          messages,
          tools: tools as Anthropic.Tool[] | undefined,
          ...(req.extra_body ?? {}),
        };
        const res = await this.client.messages.create(params);
        return fromAnthropicMessage(res);
      } catch (err) {
        throw mapError(err);
      }
    };

    return retryWithBackoff(attempt, this.maxRetries, (e) => e instanceof LlmError && e.retryable);
  }
}

function toAnthropicMessages(messages: LlmMessage[]): Anthropic.MessageParam[] {
  return messages.flatMap((m): Anthropic.MessageParam[] => {
    if (m.role === 'system') return []; // handled via `system` field
    if (typeof m.content === 'string') {
      if (m.role === 'tool') {
        // Tool result as a single user message with one tool_result block.
        return [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.name ?? '', content: m.content, is_error: false } as Anthropic.ToolResultBlockParam] }];
      }
      return [{ role: m.role, content: m.content }];
    }
    // Block form. Tool-result messages go as `tool_result` blocks.
    if (m.role === 'tool') {
      const blocks: Anthropic.ToolResultBlockParam[] = m.content.map((b) => {
        if (b.type !== 'tool_result') {
          throw new LlmError('invalid_request', `tool role message can only contain tool_result blocks, got ${b.type}`);
        }
        return {
          type: 'tool_result',
          tool_use_id: b.tool_use_id,
          content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
          is_error: b.is_error,
        };
      });
      return [{ role: 'user', content: blocks }];
    }
    // Assistant blocks: text and tool_use. Strip tool_result blocks.
    const blocks: Anthropic.ContentBlockParam[] = m.content.flatMap((b): Anthropic.ContentBlockParam[] => {
      if (b.type === 'text') return [{ type: 'text', text: b.text }];
      if (b.type === 'tool_use') {
        return [{ type: 'tool_use', id: b.id, name: b.name, input: b.input }];
      }
      return [];
    });
    return [{ role: m.role, content: blocks }];
  });
}

function fromAnthropicMessage(msg: Anthropic.Message): LlmResponse {
  const content: ContentBlock[] = msg.content.map((b): ContentBlock => {
    if (b.type === 'text') {
      const out: TextBlock = { type: 'text', text: b.text };
      return out;
    }
    if (b.type === 'tool_use') {
      const out: ToolUseBlock = { type: 'tool_use', id: b.id, name: b.name, input: b.input as Record<string, unknown> };
      return out;
    }
    throw new LlmError('unknown', `unsuported anthropic content block: ${(b as { type: string }).type}`);
  });
  return {
    id: msg.id,
    model: msg.model,
    stop_reason: mapStopReason(msg.stop_reason),
    content,
    usage: {
      input_tokens: msg.usage.input_tokens,
      output_tokens: msg.usage.output_tokens,
    },
  };
}

function mapStopReason(r: string | null): LlmResponse['stop_reason'] {
  switch (r) {
    case 'end_turn': return 'end_turn';
    case 'tool_use': return 'tool_use';
    case 'max_tokens': return 'max_tokens';
    case 'stop_sequence': return 'stop_sequence';
    default: return 'unknown';
  }
}

function mapError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  const e = err as { status?: number; code?: string; message?: string; name?: string; error?: { type?: string; message?: string } };
  const status: number = typeof e.status === 'number' ? e.status : 500;
  const code = e.code ?? e.error?.type;
  const msg = e.message ?? e.error?.message ?? 'unknown LLM error';
  if (e.name === 'AbortError' || /timeout/i.test(msg)) {
    return new LlmError('timeout', msg, { status, providerCode: code, cause: err });
  }
  if (status === 401 || status === 403) {
    return new LlmError('auth_failed', msg, { status, providerCode: code, cause: err, retryable: false });
  }
  if (status === 404) {
    return new LlmError('not_found', msg, { status, providerCode: code, cause: err, retryable: false });
  }
  if (status === 400) {
    return new LlmError('invalid_request', msg, { status, providerCode: code, cause: err, retryable: false });
  }
  if (status === 429) {
    return new LlmError('rate_limited', msg, { status, providerCode: code, cause: err });
  }
  if (status === 408 || (status >= 500 && status < 600)) {
    return new LlmError(status === 408 ? 'timeout' : 'overloaded', msg, { status, providerCode: code, cause: err });
  }
  return new LlmError('unknown', msg, { status, providerCode: code, cause: err });
}

async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries: number, isRetryable: (e: unknown) => boolean): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === maxRetries || !isRetryable(err)) throw err;
      const backoff = Math.min(8_000, 500 * 2 ** i) + Math.random() * 250;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

// Re-export ToolResultBlock so the bundler keeps the named type.
export type { ToolResultBlock };
