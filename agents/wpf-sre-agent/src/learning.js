import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_RECORDS = 500;
const MAX_MATCHES = 8;
const MAX_TEXT_LENGTH = 4000;

function validateText(value, name, { optional = false, maxLength = MAX_TEXT_LENGTH } = {}) {
  if (optional && value === undefined) return "";
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${name} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value.trim();
}

async function readRecords(filePath) {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8"));
    if (!Array.isArray(value)) throw new Error("SRE learning store must contain a JSON array");
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function terms(value) {
  return new Set(
    value.toLowerCase().match(/[a-z0-9-]{3,}/g)?.filter((word) =>
      !["container", "production", "status", "error", "issue", "activity"].includes(word),
    ) || [],
  );
}

export function createLearningStore(filePath) {
  let writes = Promise.resolve();

  async function save(records) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(records, null, 2), { mode: 0o600 });
    await rename(temporary, filePath);
  }

  async function listFeedback() {
    await writes;
    return readRecords(filePath);
  }

  return {
    async recordFeedback({ namespace, pod, issueReference, issue, diagnosis, resolution, userId }) {
      const entry = {
        id: randomUUID(),
        namespace: validateText(namespace, "namespace", { maxLength: 63 }),
        pod: validateText(pod, "pod", { maxLength: 253 }),
        issueReference: validateText(issueReference, "issueReference", { optional: true, maxLength: 256 }),
        issue: validateText(issue, "issue"),
        diagnosis: validateText(diagnosis, "diagnosis"),
        resolution: validateText(resolution, "resolution"),
        verified: true,
        recordedBy: validateText(userId, "userId", { maxLength: 256 }),
        recordedAt: new Date().toISOString(),
      };
      const operation = writes.then(async () => {
        const records = await readRecords(filePath);
        await save([...records, entry].slice(-MAX_RECORDS));
      });
      writes = operation.then(() => undefined, () => undefined);
      await operation;
      return entry;
    },

    async listFeedback() {
      return listFeedback();
    },

    async getRelevantFeedback({ namespace, pod, activity }) {
      const records = await listFeedback();
      const activityTerms = terms(JSON.stringify(activity));
      return records
        .map((record) => {
          const feedbackTerms = terms(`${record.issue} ${record.diagnosis} ${record.resolution}`);
          const overlap = [...feedbackTerms].filter((word) => activityTerms.has(word)).length;
          const samePod = record.pod === pod;
          const score = overlap * 2 + (samePod ? 5 : 0) + (record.namespace === namespace ? 2 : 0);
          return { record, score, isRelevant: overlap > 0 || samePod };
        })
        .filter(({ isRelevant }) => isRelevant)
        .sort((left, right) => right.score - left.score || right.record.recordedAt.localeCompare(left.record.recordedAt))
        .slice(0, MAX_MATCHES)
        .map(({ record }) => ({
          issueReference: record.issueReference,
          namespace: record.namespace,
          pod: record.pod,
          issue: record.issue,
          diagnosis: record.diagnosis,
          resolution: record.resolution,
          verified: record.verified,
          recordedAt: record.recordedAt,
        }));
    },
  };
}
