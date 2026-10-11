export function applyReviewGate(review, story) {
  if (review.reviewStatus !== "approved") return review;

  const hasAcceptanceCriteria = Boolean(story.acceptanceCriteria?.trim());
  const coverageFailures = review.coverage.filter((criterion) => criterion.status !== "covered");
  const distinctCoverage = new Set(review.coverage.map((criterion) => criterion.criterion.trim().toLowerCase()));
  const missingCoverage = hasAcceptanceCriteria && distinctCoverage.size === 0;
  const duplicateCoverage = distinctCoverage.size < review.coverage.length;
  const severeFindings = review.findings.some((finding) => ["critical", "major"].includes(finding.severity));
  if (!missingCoverage && !duplicateCoverage && !coverageFailures.length && !severeFindings) return review;

  const findings = [...review.findings];
  if (missingCoverage || duplicateCoverage || coverageFailures.length) {
    findings.push({
      severity: "major",
      testCaseIds: [...new Set(coverageFailures.flatMap((criterion) => criterion.testCaseIds))],
      title: "Acceptance-criterion coverage gate failed",
      rationale: missingCoverage
        ? "The story has acceptance criteria, but the review did not provide criterion-level coverage."
        : duplicateCoverage
          ? "The review contains duplicate criterion coverage entries."
        : `${coverageFailures.length} acceptance criterion or criteria were not fully covered.`,
      recommendation: "Add executable test cases for every acceptance criterion and rerun the review.",
    });
  }

  return { ...review, reviewStatus: "changes_requested", findings };
}
