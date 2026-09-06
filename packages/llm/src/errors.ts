/**
 * LLM error types. Mapped from the underlying SDK errors so callers
 * can branch on category without depending on a specific provider.
 */

export type LlmErrorKind =
  | 'auth_failed'      // bad api key, 401
  | 'rate_limited'     // 429
  | 'invalid_request'  // 400 — bad params
  | 'not_found'        // model / endpoint not found
  | 'overloaded'       // 503 / 529
  | 'timeout'
  | 'network'          // connection reset, dns, etc.
  | 'unknown';

export class LlmError extends Error {
  public readonly kind: LlmErrorKind;
  public readonly retryable: boolean;
  public readonly status?: number;
  public readonly providerCode?: string;

  constructor(kind: LlmErrorKind, message: string, opts: { status?: number; providerCode?: string; retryable?: boolean; cause?: unknown } = {}) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
    this.status = opts.status;
    this.providerCode = opts.providerCode;
    this.retryable = opts.retryable ?? defaultRetryable(kind);
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

function defaultRetryable(kind: LlmErrorKind): boolean {
  return kind === 'rate_limited' || kind === 'overloaded' || kind === 'timeout' || kind === 'network';
}
