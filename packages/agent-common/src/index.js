import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";

const SENSITIVE_KEY =
  /authorization|password|secret|token|api[-_]?key|cookie|credential|connection[-_]?string|private[-_]?key/i;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g;
const CONNECTION_SECRET = /(AccountKey|SharedAccessKey|Password|pwd)=[^;\s]+/gi;
const URL_CREDENTIALS = /(\w+:\/\/)[^/\s:@]+:[^/\s@]+@/g;

export const LOG_REDACT_PATHS = Object.freeze([
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-dev-principal"]',
  "*.authorization",
  "*.password",
  "*.apiKey",
  "*.token",
  "*.accessToken",
  "*.clientSecret",
]);

export function redactString(value) {
  return value
    .replace(BEARER, "$1 [REDACTED]")
    .replace(JWT, "[REDACTED_JWT]")
    .replace(CONNECTION_SECRET, "$1=[REDACTED]")
    .replace(URL_CREDENTIALS, "$1[REDACTED]@");
}

export function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return redactString(message).slice(0, 1000);
}

export function logError(scope, error, fields = {}, logger = console) {
  logger.error(
    JSON.stringify({
      level: "error",
      scope,
      fields: redact(fields),
      error: safeErrorMessage(error),
    }),
  );
}

export function redact(value, depth = 0) {
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value))
    return value.map((entry) => redact(entry, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(entry, depth + 1),
      ]),
    );
  }
  return value;
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
export const hashOf = (value) => sha256(stableStringify(value));
export const newId = () => randomUUID();

export function isKubernetesResourceName(value, maxLength = 253) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    /^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/.test(value)
  );
}

export function readJsonFileSync(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export function writeJsonFileAtomicallySync(
  filePath,
  value,
  { mode = 0o600 } = {},
) {
  const target = path.resolve(filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), {
      mode,
      flag: "wx",
    });
    fs.renameSync(temporary, target);
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Preserve the original filesystem error.
    }
    throw error;
  }
}

export async function writeJsonFileAtomically(
  filePath,
  value,
  { mode = 0o600 } = {},
) {
  const target = path.resolve(filePath);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), {
      mode,
      flag: "wx",
    });
    await rename(temporary, target);
  } catch (error) {
    try {
      await import("node:fs/promises").then(({ rm }) =>
        rm(temporary, { force: true }),
      );
    } catch {
      // Preserve the original filesystem error.
    }
    throw error;
  }
}

export function parseCommaSeparatedList(value) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function stripTrailingSlashes(value) {
  return value.replace(/\/+$/, "");
}
