import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve(process.env.DATA_DIR || "data");
fs.mkdirSync(DIR, { recursive: true });
const file = (key) => path.join(DIR, `${key.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);

export const saveReview = (rec) => fs.writeFileSync(file(rec.key), JSON.stringify(rec, null, 2));
export const getReview = (key) => {
  try {
    return JSON.parse(fs.readFileSync(file(key), "utf8"));
  } catch {
    return null;
  }
};
export const listReviews = () =>
  fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
