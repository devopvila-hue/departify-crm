/**
 * LlmClient — the small interface the rest of the CRM uses.
 *
 * Implementations live in their own modules (anthropic.ts, …). Use
 * `createLlmClient` from `./factory.js` to build one from config.
 */
import type { LlmRequest, LlmResponse, LlmMessage, ToolDefinition, ContentBlock } from './types.js';

export interface LlmClient {
  chat(req: LlmRequest): Promise<LlmResponse>;
}

/** Convenience: extract the first text block from a response. */
export function responseText(res: LlmResponse): string {
  return res.content
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/** Convenience: extract tool_use blocks. */
export function toolUses(res: LlmResponse): Array<Extract<ContentBlock, { type: 'tool_use' }>> {
  return res.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
}

/**
 * Tiny agent loop: call chat(), if the model wants tools, run them,
 * feed the results back, repeat until end_turn or max_steps.
 *
 * The tool runner is the caller's responsibility — the loop just
 * sequences messages and stops at end_turn / max_steps / any error.
 */
export interface AgentStep {
  messages: LlmMessage[];
  response: LlmResponse;
  /** If the model wanted tools and they ran, the tool results that were appended. */
  ranTools: boolean;
}

export interface AgentLoopOptions {
  system?: string;
  tools?: ToolDefinition[];
  maxSteps?: number;
  model: string;
  maxTokens: number;
  temperature?: number;
  /** If the model requested tools, the runner returns a result. */
  runTools: (uses: Array<Extract<ContentBlock, { type: 'tool_use' }>>) => Promise<ContentBlock[]>;
}

export interface AgentLoopResult {
  steps: AgentStep[];
  final: LlmResponse;
  totalUsage: { input_tokens: number; output_tokens: number };
}

export async function runAgentLoop(
  client: LlmClient,
  initialMessages: LlmMessage[],
  opts: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const maxSteps = opts.maxSteps ?? 6;
  const messages: LlmMessage[] = [...initialMessages];
  const steps: AgentStep[] = [];
  const totalUsage = { input_tokens: 0, output_tokens: 0 };
  let last: LlmResponse | null = null;
  for (let i = 0; i < maxSteps; i++) {
    const res = await client.chat({
      model: opts.model,
      system: opts.system,
      messages,
      tools: opts.tools,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
    });
    last = res;
    totalUsage.input_tokens += res.usage.input_tokens;
    totalUsage.output_tokens += res.usage.output_tokens;
    const uses = toolUses(res);
    if (uses.length === 0 || res.stop_reason !== 'tool_use') {
      steps.push({ messages, response: res, ranTools: false });
      return { steps, final: res, totalUsage };
    }
    messages.push({ role: 'assistant', content: res.content });
    const toolResults = await opts.runTools(uses);
    messages.push({ role: 'user', content: toolResults });
    steps.push({ messages, response: res, ranTools: true });
  }
  if (!last) throw new Error('agent loop did not execute any step');
  return { steps, final: last, totalUsage };
}
