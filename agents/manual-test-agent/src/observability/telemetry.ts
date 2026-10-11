import {
  context,
  metrics,
  propagation,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
} from '@opentelemetry/api';
import { pino, type Logger } from 'pino';
import { LOG_REDACT_PATHS } from '../security/redaction.js';

const SCOPE = 'manual-test-agent';
const tracer = trace.getTracer(SCOPE);
const meter = metrics.getMeter(SCOPE);

export const m = {
  workflowNodeDuration: meter.createHistogram('agent.workflow.node.duration', { unit: 'ms' }),
  workflowNodeErrors: meter.createCounter('agent.workflow.node.errors'),
  mcpLatency: meter.createHistogram('agent.mcp.latency', { unit: 'ms' }),
  mcpFailures: meter.createCounter('agent.mcp.failures'),
  modelLatency: meter.createHistogram('agent.model.latency', { unit: 'ms' }),
  modelThrottled: meter.createCounter('agent.model.throttled'),
  modelTokens: meter.createCounter('agent.model.tokens'),
  modelCostUsd: meter.createCounter('agent.model.cost_usd'),
  validationFailures: meter.createCounter('agent.validation.failures'),
  coveragePercent: meter.createHistogram('agent.coverage.percent', { unit: '%' }),
  duplicatesFlagged: meter.createCounter('agent.duplicates.flagged'),
  reviewDecisions: meter.createCounter('agent.review.decisions'),
  publicationFailures: meter.createCounter('agent.publication.failures'),
  publicationSuccesses: meter.createCounter('agent.publication.successes'),
  jobsCompleted: meter.createCounter('agent.jobs.completed'),
  messagesDeadLettered: meter.createCounter('agent.messages.dead_lettered'),
  injectionSuspected: meter.createCounter('agent.context.injection_suspected'),
};

export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
  parent?: Context,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, parent ?? context.active(), async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.name : 'error' });
      throw err;
    } finally {
      span.end();
    }
  });
}

export const injectTraceContext = (): Record<string, string> => {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
};

export const extractTraceContext = (carrier: Record<string, unknown> | undefined): Context =>
  propagation.extract(context.active(), carrier ?? {});

export function createLogger(level = 'info', base: Record<string, unknown> = {}): Logger {
  return pino({
    level,
    base,
    redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export async function initTelemetry(serviceName: string, connectionString?: string): Promise<void> {
  if (!connectionString) return;
  process.env['OTEL_SERVICE_NAME'] ??= serviceName;
  const { useAzureMonitor } = await import('@azure/monitor-opentelemetry');
  useAzureMonitor({ azureMonitorExporterOptions: { connectionString } });
}
