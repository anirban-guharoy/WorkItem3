import type { QueueMessage } from '../schemas/domain.js';

export interface MessageMeta {
  messageId: string;
  deliveryCount: number;
  traceCarrier: Record<string, string>;
}

export type MessageHandler = (message: QueueMessage, meta: MessageMeta) => Promise<void>;
export type DeadLetterHandler = (message: QueueMessage | undefined, reason: string) => Promise<void>;

export interface QueuePublisher {
  send(
    message: QueueMessage,
    options?: { delayMs?: number; traceCarrier?: Record<string, string> },
  ): Promise<void>;
  close(): Promise<void>;
}

export interface QueueConsumer {
  /** Begins processing; resolves once subscribed. */
  start(handler: MessageHandler, onDeadLetter: DeadLetterHandler): Promise<void>;
  /** Stops accepting messages and waits for in-flight handlers (graceful shutdown). */
  stop(): Promise<void>;
}

export const messageIdOf = (m: QueueMessage): string =>
  `${m.type}:${m.jobId}:${m.attempt}:${m.publicationId ?? ''}:${m.publicationVersion ?? ''}`;

/** Marks a message that can never succeed (malformed, unknown version): dead-lettered without retries. */
export class PoisonMessageError extends Error {}
