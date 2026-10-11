import type { JiraStory, NormalizedCriterion } from '../schemas/domain.js';
import { LIMITS } from '../schemas/common.js';

const MARKER = /^\s*(?:AC\s*-?\s*\d+\s*[:.)-]|\d+\s*[.)]|[-*•]\s+|\[[ xX]?\]\s+)\s*(.*\S.*)$/i;
const SCENARIO_START = /^\s*(?:scenario|given)\b/i;

export function splitCriteria(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd());
  const hasMarkers = lines.some((l) => MARKER.test(l));
  const items: string[] = [];
  if (hasMarkers) {
    for (const line of lines) {
      const marker = MARKER.exec(line);
      if (marker?.[1]) items.push(marker[1].trim());
      else if (line.trim() && items.length) items[items.length - 1] += ` ${line.trim()}`;
    }
    return items;
  }
  if (lines.some((l) => SCENARIO_START.test(l))) {
    for (const line of lines) {
      if (!line.trim()) continue;
      if (SCENARIO_START.test(line) || items.length === 0) items.push(line.trim());
      else items[items.length - 1] += ` ${line.trim()}`;
    }
    return items;
  }
  return lines.map((l) => l.trim()).filter(Boolean);
}

/**
 * Prefers the dedicated acceptance-criteria field; falls back to an "Acceptance Criteria" section
 * of the description. Never invents criteria: if none are found the result is empty.
 */
export function normalizeAcceptanceCriteria(story: JiraStory): NormalizedCriterion[] {
  let field: 'acceptanceCriteria' | 'description' = 'acceptanceCriteria';
  let text = story.acceptanceCriteriaField?.trim() ?? '';
  if (!text) {
    const section = /acceptance criteria\s*:?\s*\r?\n([\s\S]+)$/i.exec(story.description);
    text = section?.[1]?.trim() ?? '';
    field = 'description';
  }
  if (!text) return [];
  return splitCriteria(text)
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter((t) => t.length >= 3)
    .slice(0, LIMITS.maxCriteria)
    .map((t, i) => ({
      id: `AC-${i + 1}`,
      text: t.slice(0, LIMITS.longText),
      idOrigin: 'application_generated' as const,
      source: { type: 'jira' as const, ref: story.key, field },
    }));
}
