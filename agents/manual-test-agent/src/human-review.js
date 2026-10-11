export function applyHumanDecision(review, { decision, comment, reviewer, decidedAt, cycleName }) {
  if (!["approved", "rejected"].includes(decision)) {
    throw new Error("Human review decision must be approved or rejected");
  }
  const outcome = {
    decision,
    comment,
    reviewer: {
      id: reviewer.userId,
      name: reviewer.name,
      username: reviewer.username,
    },
    decidedAt,
  };
  const reviewedSet = {
    summary: review.output?.summary || "",
    testCases: (review.output?.testCases || []).slice(0, 50).map((testCase) => ({
      id: testCase.id,
      title: testCase.title,
      type: testCase.type,
      priority: testCase.priority,
      acceptanceCriterion: testCase.acceptanceCriterion,
      steps: testCase.steps,
      expectedResult: testCase.expectedResult,
    })),
  };
  return {
    ...review,
    status: decision,
    reviewerComment: comment,
    humanReview: outcome,
    humanReviewHistory: [...(review.humanReviewHistory || []), outcome],
    humanLearningHistory: [
      ...(review.humanLearningHistory || []),
      {
        decision,
        comment,
        story: review.story,
        output: reviewedSet,
        decidedAt,
      },
    ].slice(-20),
    cycleName,
    updatedAt: decidedAt,
  };
}
