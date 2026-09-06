/**
 * LLM client — types shared across all providers.
 *
 * Kept intentionally small. The point of this layer is to let the CRM
 * talk to any Anthropic-compatible endpoint (real Anthropic, MiniMax,
 * OpenRouter, …) without leaking provider SDK types into the rest of
 * the code.
 *
 * Tool / function calling is first-class because the MCP server
 * relies on it for agentic flows.
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  /** Provider-agnostic id. The provider maps it to its own format. */
  id: string;
  name: string;
  /** JSON-serialisable input object. */
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  /** Must match a `ToolUseBlock.id`. */
  tool_use_id: string;
  /** Either plain text or a JSON-serialisable object that the LLM can read. */
  content: string | Record<string, unknown>;
  /** True if the tool execution failed and the LLM should treat it as an error. */
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

/** A message in the conversation. `content` is either a string or blocks. */
export interface LlmMessage {
  role: Role;
  content: string | ContentBlock[];
  /** Optional name for tool-result messages (Anthropic uses tool_use_id). */
  name?: string;
}

export interface ToolDefinition {
  /** Provider-agnostic name. Use snake_case. */
  name: string;
  description: string;
  /** JSON Schema (Draft 7 subset). */
  input_schema: Record<string, unknown>;
}

export interface LlmRequest {
  model: string;
  system?: string;
  messages: LlmMessage[];
  tools?: ToolDefinition[];
  max_tokens: number;
  temperature?: number;
  /** Pass `extra_body` for provider-specific knobs (e.g. thinking budget). */
  extra_body?: Record<string, unknown>;
}

export interface LlmUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface LlmResponse {
  id: string;
  model: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'unknown';
  content: ContentBlock[];
  usage: LlmUsage;
}
