import path from "node:path";
import {
  hashOf,
  readJsonFileSync,
  writeJsonFileAtomicallySync,
} from "@workitem3/agent-common";

const dataDir = path.resolve(process.env.DATA_DIR || "data");

export function reviewId(input) {
  return hashOf(input);
}

function recordPath(id) {
  return path.join(dataDir, `${id}.json`);
}

export function getReviewRecord(id) {
  try {
    return readJsonFileSync(recordPath(id));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

export function saveReviewRecord(id, record) {
  writeJsonFileAtomicallySync(recordPath(id), record);
}
