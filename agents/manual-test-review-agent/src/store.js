import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.env.DATA_DIR || "data");
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function reviewId(input) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(input))).digest("hex");
}

function recordPath(id) {
  return path.join(dataDir, `${id}.json`);
}

export function getReviewRecord(id) {
  try {
    return JSON.parse(fs.readFileSync(recordPath(id), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

export function saveReviewRecord(id, record) {
  const target = recordPath(id);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(record, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, target);
}
