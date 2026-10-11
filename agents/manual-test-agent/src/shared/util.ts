import { randomUUID } from 'node:crypto';
import { sha256, stableStringify } from '@workitem3/agent-common';

export { sha256, stableStringify };

export const newId = (): string => randomUUID();

export const hashOf = (value: unknown): string => sha256(stableStringify(value));

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { retries: number; baseDelayMs: number; shouldRetry: (err: unknown) => boolean },
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= opts.retries || !opts.shouldRetry(err)) throw err;
      const delay = opts.baseDelayMs * 2 ** attempt * (0.5 + Math.random() / 2);
      attempt += 1;
      await sleep(delay);
    }
  }
}

export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };
