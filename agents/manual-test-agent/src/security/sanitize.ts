import { truncate } from '../shared/text.js';

// Heuristic signatures of instructions aimed at an LLM. Detection only flags content for the
// reviewer and audit log; defence in depth comes from delimiting, schema validation and the
// absence of any model-callable tools.
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions|prompts?|rules)/i,
  /disregard (all |any )?(the )?(previous|prior|above|system)/i,
  /you are now\b/i,
  /\bsystem prompt\b/i,
  /\b(reveal|print|show|leak) (your|the) (instructions|prompt|secrets?|credentials?|api key)/i,
  /\b(approve|publish) (these|all|the) (test ?cases|drafts?)\b/i,
  /\bcall (the )?(tool|function)\b/i,
  /<\/?(system|assistant|instructions?|untrusted_data)\b/i,
  /\bBEGIN (SYSTEM|INSTRUCTIONS)\b/i,
];

export function detectPromptInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(text));
}

/* eslint-disable no-control-regex */
const CONTROL_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;
/* eslint-enable no-control-regex */

/** Removes control/bidi characters, neutralises delimiter look-alikes and bounds the length. */
export function sanitizeUntrusted(text: string, maxLength: number): string {
  return truncate(
    text
      .replace(CONTROL_CHARS, '')
      .replace(/<(\/?)\s*(untrusted_data|system|assistant|instructions?)/gi, '&lt;$1$2')
      .trim(),
    maxLength,
  );
}

export function wrapUntrusted(label: string, text: string): string {
  const safeLabel = label.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 80);
  return `<untrusted_data source="${safeLabel}">\n${text}\n</untrusted_data>`;
}
