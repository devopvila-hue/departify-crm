/**
 * Shared helpers for the MCP tool modules. Keeps individual files tiny.
 */
export function jsonOut(payload: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}
export function errOut(code: string, message?: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return { content: [{ type: 'text', text: JSON.stringify({ error: code, message }) }], isError: true };
}
