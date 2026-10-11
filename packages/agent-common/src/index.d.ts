export declare const LOG_REDACT_PATHS: string[];
export declare function redactString(value: string): string;
export declare function safeErrorMessage(error: unknown): string;
export declare function logError(
  scope: string,
  error: unknown,
  fields?: Record<string, unknown>,
  logger?: { error(...args: unknown[]): void },
): void;
export declare function redact<T>(value: T, depth?: number): T | "[TRUNCATED]";
export declare function stableStringify(value: unknown): string;
export declare function sha256(value: string): string;
export declare function hashOf(value: unknown): string;
export declare function newId(): string;
export declare function isKubernetesResourceName(
  value: unknown,
  maxLength?: number,
): value is string;
export declare function readJsonFileSync<T = unknown>(filePath: string): T;
export declare function readJsonFile<T = unknown>(filePath: string): Promise<T>;
export declare function writeJsonFileAtomicallySync(
  filePath: string,
  value: unknown,
  options?: { mode?: number },
): void;
export declare function writeJsonFileAtomically(
  filePath: string,
  value: unknown,
  options?: { mode?: number },
): Promise<void>;
export declare function parseCommaSeparatedList(value?: string): string[];
export declare function stripTrailingSlashes(value: string): string;
