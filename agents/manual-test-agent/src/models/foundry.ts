import { DefaultAzureCredential, type TokenCredential } from '@azure/identity';
import type { z } from 'zod';
import { m, withSpan } from '../observability/telemetry.js';
import {
  PROMPT_VERSION,
  renderAnalysisPrompt,
  renderGenerationPrompt,
  SYSTEM_PROMPT,
} from '../prompts/index.js';
import { RequirementsAnalysisSchema } from '../schemas/domain.js';
import { GeneratedTestCasesSchema } from '../schemas/testcase.js';
import { AppError, UpstreamError } from '../shared/errors.js';
import { sleep } from '../shared/util.js';
import { parseModelOutput } from './parse.js';
import type {
  AnalysisInput,
  GenerationInput,
  ModelInfo,
  ModelResult,
  ModelUsage,
  TestGenerationModel,
} from './types.js';

export interface FoundryOptions {
  endpoint: string;
  deployment: string;
  apiVersion: string;
  authMode: 'api-key' | 'entra';
  apiKey?: string | undefined;
  entraScope: string;
  timeoutMs: number;
  maxRetries: number;
  maxOutputTokens: number;
  temperature: number;
  priceInputPerMTok?: number | undefined;
  priceOutputPerMTok?: number | undefined;
  credential?: TokenCredential;
  fetchImpl?: typeof fetch;
}

interface MessagesResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Claude via Azure AI Foundry using the Anthropic Messages API surface ({endpoint}/v1/messages).
 * Structured output is not assumed to be available: the model is instructed to return JSON, which
 * is parsed and validated with Zod, with one bounded repair round-trip on validation failure.
 * This adapter has not been exercised against a live deployment in this repository; see
 * docs/model-configuration.md for the verification checklist.
 */
export class FoundryClaudeModel implements TestGenerationModel {
  readonly info: ModelInfo;
  private readonly credential: TokenCredential | undefined;
  private readonly doFetch: typeof fetch;

  constructor(private readonly o: FoundryOptions) {
    this.info = { provider: 'azure-ai-foundry', modelId: o.deployment, promptVersion: PROMPT_VERSION };
    this.credential = o.authMode === 'entra' ? (o.credential ?? new DefaultAzureCredential()) : undefined;
    this.doFetch = o.fetchImpl ?? fetch;
  }

  private async headers(): Promise<Record<string, string>> {
    const base: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': this.o.apiVersion,
    };
    if (this.o.authMode === 'api-key') {
      if (!this.o.apiKey) throw new AppError('Model API key is not configured', 'internal', 500);
      base['x-api-key'] = this.o.apiKey;
    } else {
      const token = await this.credential?.getToken(this.o.entraScope);
      if (!token)
        throw new UpstreamError(
          'Could not acquire Entra token for the model endpoint',
          'upstream_model',
          true,
        );
      base['authorization'] = `Bearer ${token.token}`;
    }
    return base;
  }

  private async post(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<MessagesResponse> {
    const url = `${this.o.endpoint.replace(/\/+$/, '')}/v1/messages`;
    for (let attempt = 0; ; attempt += 1) {
      let res: Response;
      try {
        res = await this.doFetch(url, {
          method: 'POST',
          headers: await this.headers(),
          body: JSON.stringify({
            model: this.o.deployment,
            max_tokens: this.o.maxOutputTokens,
            temperature: this.o.temperature,
            system: SYSTEM_PROMPT,
            messages,
          }),
          signal: AbortSignal.timeout(this.o.timeoutMs),
        });
      } catch (err) {
        if (attempt < this.o.maxRetries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new UpstreamError('Model request failed or timed out', 'upstream_model', true, err);
      }
      if (res.ok) return (await res.json()) as MessagesResponse;
      const throttled = res.status === 429;
      if (throttled) m.modelThrottled.add(1);
      const retryable = throttled || res.status >= 500 || res.status === 408;
      if (retryable && attempt < this.o.maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter, 30) * 1000
            : 1000 * 2 ** attempt,
        );
        continue;
      }
      // The response body is intentionally not propagated: it may echo prompt content.
      throw new UpstreamError(`Model endpoint returned HTTP ${res.status}`, 'upstream_model', retryable);
    }
  }

  private async run<S extends z.ZodType>(
    operation: string,
    schema: S,
    prompt: string,
  ): Promise<ModelResult<z.infer<S>>> {
    const started = Date.now();
    return withSpan(
      'model.invoke',
      { 'model.operation': operation, 'model.id': this.o.deployment, 'prompt.version': PROMPT_VERSION },
      async () => {
        const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
          { role: 'user', content: prompt },
        ];
        let inputTokens = 0;
        let outputTokens = 0;
        let attempts = 0;
        for (;;) {
          attempts += 1;
          const response = await this.post(messages);
          inputTokens += response.usage?.input_tokens ?? 0;
          outputTokens += response.usage?.output_tokens ?? 0;
          const text = (response.content ?? [])
            .filter((c) => c.type === 'text')
            .map((c) => c.text ?? '')
            .join('');
          try {
            if (response.stop_reason === 'max_tokens')
              throw new AppError('Model output was truncated', 'model_output_invalid', 502);
            const value = parseModelOutput(schema, text);
            const latencyMs = Date.now() - started;
            const cost =
              this.o.priceInputPerMTok !== undefined && this.o.priceOutputPerMTok !== undefined
                ? (inputTokens * this.o.priceInputPerMTok + outputTokens * this.o.priceOutputPerMTok) /
                  1_000_000
                : undefined;
            const usage: ModelUsage = {
              inputTokens,
              outputTokens,
              latencyMs,
              attempts,
              estimatedCostUsd: cost,
            };
            m.modelLatency.record(latencyMs, { operation });
            m.modelTokens.add(inputTokens, { direction: 'input' });
            m.modelTokens.add(outputTokens, { direction: 'output' });
            if (cost !== undefined) m.modelCostUsd.add(cost);
            return { value, usage, model: this.info };
          } catch (err) {
            const repairable =
              err instanceof AppError && err.category === 'model_output_invalid' && attempts <= 1;
            if (!repairable) throw err;
            messages.push(
              { role: 'assistant', content: text.slice(0, 20_000) },
              {
                role: 'user',
                content: `Your previous output was rejected: ${(err as AppError).message}. Return the corrected JSON object only.`,
              },
            );
          }
        }
      },
    );
  }

  analyzeRequirements(
    input: AnalysisInput,
  ): Promise<ModelResult<z.infer<typeof RequirementsAnalysisSchema>>> {
    return this.run('analyze', RequirementsAnalysisSchema, renderAnalysisPrompt(input));
  }

  generateTestCases(input: GenerationInput): Promise<ModelResult<z.infer<typeof GeneratedTestCasesSchema>>> {
    return this.run('generate', GeneratedTestCasesSchema, renderGenerationPrompt(input));
  }
}
