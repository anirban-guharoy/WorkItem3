import { DefaultAzureCredential } from '@azure/identity';
import {
  ServiceBusClient,
  type ProcessErrorArgs,
  type ServiceBusReceivedMessage,
  type ServiceBusReceiver,
  type ServiceBusSender,
} from '@azure/service-bus';
import type { Logger } from 'pino';
import { QueueMessageSchema, type QueueMessage } from '../schemas/domain.js';
import { RetryLaterError } from '../shared/errors.js';
import { sleep } from '../shared/util.js';
import {
  messageIdOf,
  PoisonMessageError,
  type DeadLetterHandler,
  type MessageHandler,
  type QueueConsumer,
  type QueuePublisher,
} from './types.js';

export interface ServiceBusOptions {
  queue: string;
  namespace?: string | undefined;
  connectionString?: string | undefined;
  concurrency: number;
  maxDeliveryAttempts: number;
  logger: Logger;
}

export function createServiceBusClient(
  o: Pick<ServiceBusOptions, 'namespace' | 'connectionString'>,
): ServiceBusClient {
  if (o.connectionString) return new ServiceBusClient(o.connectionString);
  if (!o.namespace) throw new Error('SERVICEBUS_NAMESPACE is required');
  return new ServiceBusClient(o.namespace, new DefaultAzureCredential());
}

export class ServiceBusPublisher implements QueuePublisher {
  private readonly client: ServiceBusClient;
  private readonly sender: ServiceBusSender;

  constructor(private readonly o: ServiceBusOptions) {
    this.client = createServiceBusClient(o);
    this.sender = this.client.createSender(o.queue);
  }

  async send(
    message: QueueMessage,
    options?: { delayMs?: number; traceCarrier?: Record<string, string> },
  ): Promise<void> {
    const delayed = options?.delayMs !== undefined && options.delayMs > 0;
    const sbMessage = {
      body: message,
      // Fixed ids let the queue's duplicate detection drop accidental double submissions; delayed re-enqueues get a unique id.
      messageId: delayed ? `${messageIdOf(message)}:${Date.now()}` : messageIdOf(message),
      correlationId: message.correlationId,
      subject: message.type,
      contentType: 'application/json',
      applicationProperties: { schemaVersion: message.schemaVersion, ...(options?.traceCarrier ?? {}) },
    };
    if (delayed)
      await this.sender.scheduleMessages(sbMessage, new Date(Date.now() + (options?.delayMs ?? 0)));
    else await this.sender.sendMessages(sbMessage);
  }

  async close(): Promise<void> {
    await this.sender.close();
    await this.client.close();
  }
}

export class ServiceBusConsumer implements QueueConsumer {
  private client: ServiceBusClient | undefined;
  private receiver: ServiceBusReceiver | undefined;
  private subscription: { close(): Promise<void> } | undefined;
  private inFlight = 0;

  constructor(
    private readonly o: ServiceBusOptions,
    private readonly publisher: QueuePublisher,
  ) {}

  async start(handler: MessageHandler, onDeadLetter: DeadLetterHandler): Promise<void> {
    this.client = createServiceBusClient(this.o);
    this.receiver = this.client.createReceiver(this.o.queue, { receiveMode: 'peekLock' });
    const receiver = this.receiver;
    this.subscription = receiver.subscribe(
      {
        processMessage: async (raw: ServiceBusReceivedMessage) => {
          this.inFlight += 1;
          try {
            await this.handle(receiver, raw, handler, onDeadLetter);
          } finally {
            this.inFlight -= 1;
          }
        },
        processError: async (args: ProcessErrorArgs) => {
          this.o.logger.error(
            { source: args.errorSource, entity: args.entityPath, error: args.error.name },
            'service bus receiver error',
          );
        },
      },
      { autoCompleteMessages: false, maxConcurrentCalls: this.o.concurrency },
    );
  }

  private async handle(
    receiver: ServiceBusReceiver,
    raw: ServiceBusReceivedMessage,
    handler: MessageHandler,
    onDead: DeadLetterHandler,
  ): Promise<void> {
    const parsed = QueueMessageSchema.safeParse(raw.body);
    if (!parsed.success) {
      await receiver.deadLetterMessage(raw, {
        deadLetterReason: 'MalformedMessage',
        deadLetterErrorDescription: 'Schema validation failed',
      });
      await onDead(undefined, 'malformed message').catch(() => undefined);
      return;
    }
    const message = parsed.data;
    const carrier = Object.fromEntries(
      Object.entries(raw.applicationProperties ?? {}).filter(([, v]) => typeof v === 'string'),
    ) as Record<string, string>;
    try {
      await handler(message, {
        messageId: String(raw.messageId ?? ''),
        deliveryCount: raw.deliveryCount ?? 1,
        traceCarrier: carrier,
      });
      await receiver.completeMessage(raw);
    } catch (err) {
      if (err instanceof RetryLaterError) {
        await this.publisher.send(message, { delayMs: err.delayMs, traceCarrier: carrier });
        await receiver.completeMessage(raw);
        return;
      }
      const poison = err instanceof PoisonMessageError;
      if (poison || (raw.deliveryCount ?? 1) >= this.o.maxDeliveryAttempts) {
        await receiver.deadLetterMessage(raw, {
          deadLetterReason: poison ? 'PoisonMessage' : 'MaxDeliveryAttemptsExceeded',
          deadLetterErrorDescription: err instanceof Error ? err.name : 'error',
        });
        await onDead(message, poison ? 'poison message' : 'max delivery attempts exceeded').catch(
          () => undefined,
        );
      } else {
        await receiver.abandonMessage(raw);
      }
    }
  }

  async stop(): Promise<void> {
    await this.subscription?.close();
    while (this.inFlight > 0) await sleep(50);
    await this.receiver?.close();
    await this.client?.close();
  }
}
