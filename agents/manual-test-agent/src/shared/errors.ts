export type ErrorCategory =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invalid_transition'
  | 'upstream_mcp'
  | 'upstream_model'
  | 'model_output_invalid'
  | 'rate_limited'
  | 'internal'
  | 'cancelled';

export class AppError extends Error {
  constructor(
    message: string,
    readonly category: ErrorCategory,
    readonly statusCode: number,
    readonly retryable = false,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string) => new AppError(`${what} not found`, 'not_found', 404);
export const forbidden = (msg = 'Forbidden') => new AppError(msg, 'forbidden', 403);
export const unauthenticated = (msg = 'Authentication required') => new AppError(msg, 'unauthenticated', 401);
export const conflict = (msg: string, details?: unknown) =>
  new AppError(msg, 'conflict', 409, false, details);
export const invalidInput = (msg: string, details?: unknown) =>
  new AppError(msg, 'validation', 400, false, details);

export class InvalidTransitionError extends AppError {
  constructor(from: string, to: string) {
    super(`Invalid job state transition ${from} -> ${to}`, 'invalid_transition', 409);
  }
}

/** Thrown inside the worker when a message should be redelivered later without failing the job. */
export class RetryLaterError extends Error {
  constructor(
    message: string,
    readonly delayMs = 30_000,
  ) {
    super(message);
    this.name = 'RetryLaterError';
  }
}

export class UpstreamError extends AppError {
  constructor(
    message: string,
    category: 'upstream_mcp' | 'upstream_model',
    retryable: boolean,
    override readonly cause?: unknown,
  ) {
    super(message, category, 502, retryable);
  }
}

export const isRetryable = (err: unknown): boolean => err instanceof AppError && err.retryable;

/** A message that is safe to persist and return to clients. */
export const safeMessage = (err: unknown): string =>
  err instanceof AppError ? err.message.slice(0, 500) : 'Internal error';
export const categoryOf = (err: unknown): ErrorCategory =>
  err instanceof AppError ? err.category : 'internal';
