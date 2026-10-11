import { QueueMessageSchema, type QueueMessage } from '../schemas/domain.js';
import { RetryLaterError } from '../shared/errors.js';
import { newId, sleep } from '../shared/util.js';
import {
  messageIdOf,
  PoisonMessageError,
  type DeadLetterHandler,
  type MessageHandler,
  type QueueConsumer,
  type QueuePublisher,
} from './types.js';

interface Entry {
  message: unknown;
  id: string;
  deliveries: number;
  availableAt: number;
  carrier: Record<string, string>;
}

/** In-process queue with at-least-once semantics (redelivery, delay, dead-letter) for local mode and tests. */
export class InMemoryQueue implements QueuePublisher, QueueConsumer {
  private readonly entries: Entry[] = [];
  readonly deadLetters: Array<{ message: unknown; reason: string }> = [];
  private handler: MessageHandler | undefined;
  private onDead: DeadLetterHandler | undefined;
  private running = false;
  private inFlight = 0;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly opts: { maxDeliveryAttempts: number; concurrency: number; pollMs?: number }) {}

  async send(
    message: QueueMessage,
    options?: { delayMs?: number; traceCarrier?: Record<string, string> },
  ): Promise<void> {
    this.enqueueRaw(message, messageIdOf(message), options);
  }

  /** Test hook: enqueue arbitrary (possibly malformed) payloads. */
  enqueueRaw(
    message: unknown,
    id: string,
    options?: { delayMs?: number; traceCarrier?: Record<string, string> },
  ): void {
    if (options?.delayMs === undefined && this.entries.some((e) => e.id === id)) return; // duplicate detection
    this.entries.push({
      message,
      id: options?.delayMs ? `${id}:${newId()}` : id,
      deliveries: 0,
      availableAt: Date.now() + (options?.delayMs ?? 0),
      carrier: options?.traceCarrier ?? {},
    });
  }

  async start(handler: MessageHandler, onDeadLetter: DeadLetterHandler): Promise<void> {
    this.handler = handler;
    this.onDead = onDeadLetter;
    this.running = true;
    this.timer = setInterval(() => void this.pump(), this.opts.pollMs ?? 25);
    void this.pump();
  }

  private async pump(): Promise<void> {
    while (this.running && this.inFlight < this.opts.concurrency) {
      const now = Date.now();
      const entry = this.entries.find((e) => e.availableAt <= now);
      if (!entry) return;
      this.entries.splice(this.entries.indexOf(entry), 1);
      this.inFlight += 1;
      void this.process(entry).finally(() => {
        this.inFlight -= 1;
      });
    }
  }

  private async process(entry: Entry): Promise<void> {
    entry.deliveries += 1;
    const parsed = QueueMessageSchema.safeParse(entry.message);
    if (!parsed.success) {
      await this.dead(undefined, entry, 'malformed or unsupported message');
      return;
    }
    try {
      await this.handler?.(parsed.data, {
        messageId: entry.id,
        deliveryCount: entry.deliveries,
        traceCarrier: entry.carrier,
      });
    } catch (err) {
      if (err instanceof RetryLaterError) {
        entry.deliveries -= 1;
        entry.availableAt = Date.now() + err.delayMs;
        this.entries.push(entry);
      } else if (err instanceof PoisonMessageError || entry.deliveries >= this.opts.maxDeliveryAttempts) {
        await this.dead(
          parsed.data,
          entry,
          err instanceof PoisonMessageError ? err.message : 'max delivery attempts exceeded',
        );
      } else {
        entry.availableAt = Date.now() + 10;
        this.entries.push(entry);
      }
    }
  }

  private async dead(message: QueueMessage | undefined, entry: Entry, reason: string): Promise<void> {
    this.deadLetters.push({ message: entry.message, reason });
    await this.onDead?.(message, reason).catch(() => undefined);
  }

  /** Test hook: resolves when nothing is queued (ignoring delayed items) and nothing is in flight. */
  async drain(timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.entries.length === 0 && this.inFlight === 0) return;
      await sleep(10);
    }
    throw new Error('queue did not drain in time');
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    while (this.inFlight > 0) await sleep(10);
  }

  async close(): Promise<void> {
    await this.stop();
  }
}
