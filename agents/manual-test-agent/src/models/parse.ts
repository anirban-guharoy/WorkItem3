import type { z } from 'zod';
import { AppError } from '../shared/errors.js';

export function extractJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start)
    throw new AppError('Model output contained no JSON object', 'model_output_invalid', 502);
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    throw new AppError('Model output was not valid JSON', 'model_output_invalid', 502);
  }
}

export function parseModelOutput<S extends z.ZodType>(schema: S, text: string): z.infer<S> {
  const result = schema.safeParse(extractJson(text));
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new AppError(`Model output failed schema validation: ${issues}`, 'model_output_invalid', 502);
  }
  return result.data;
}
