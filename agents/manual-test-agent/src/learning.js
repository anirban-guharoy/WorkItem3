const MAX_LESSONS = 4;
const MAX_CASES_PER_LESSON = 8;
const MAX_FIELD_LENGTH = 500;

const STOP_WORDS = new Set([
  "about", "after", "also", "and", "are", "can", "for", "from", "into", "its", "that", "the",
  "their", "then", "this", "with", "user", "when", "where", "will", "would",
]);

function storyText(story = {}) {
  return [story.key, story.summary, story.description, story.acceptanceCriteria]
    .filter((value) => typeof value === "string")
    .join(" ");
}

function terms(value) {
  return new Set(
    value.toLowerCase().match(/[a-z0-9-]{3,}/g)?.filter((word) => !STOP_WORDS.has(word)) || [],
  );
}

function truncate(value) {
  return typeof value === "string" ? value.slice(0, MAX_FIELD_LENGTH) : "";
}

export function selectRelevantReviewLessons(story, reviews) {
  const currentTerms = terms(storyText(story));
  return reviews
    .flatMap((review) => (review.humanLearningHistory || []).map((lesson) => ({ review, lesson })))
    .map(({ review, lesson }) => {
      const historicalTerms = terms(storyText(lesson.story));
      const overlap = [...currentTerms].filter((word) => historicalTerms.has(word)).length;
      const sameStory = Boolean(story.key && story.key === lesson.story?.key);
      return { review, lesson, score: sameStory ? 1000 : overlap };
    })
    .filter(({ lesson, score }) =>
      lesson.output && (score >= 2 || (score >= 1 && Boolean(lesson.comment?.trim()))),
    )
    .sort((left, right) =>
      right.score - left.score || right.lesson.decidedAt.localeCompare(left.lesson.decidedAt),
    )
    .slice(0, MAX_LESSONS)
    .map(({ review, lesson }) => ({
      storyKey: lesson.story?.key || review.key,
      storySummary: truncate(lesson.story?.summary),
      decision: lesson.decision,
      reviewerComment: truncate(lesson.comment),
      testSetSummary: truncate(lesson.output.summary),
      testCases: (lesson.output.testCases || []).slice(0, MAX_CASES_PER_LESSON).map((testCase) => ({
        id: truncate(testCase.id),
        title: truncate(testCase.title),
        type: truncate(testCase.type),
        priority: truncate(testCase.priority),
        acceptanceCriterion: truncate(testCase.acceptanceCriterion),
        steps: (testCase.steps || []).slice(0, 8).map(truncate),
        expectedResult: truncate(testCase.expectedResult),
      })),
      reviewedAt: lesson.decidedAt,
    }));
}

export function formatReviewLessons(lessons) {
  if (!lessons.length) return "No relevant human-reviewed examples are available.";
  return JSON.stringify(lessons, null, 2);
}
