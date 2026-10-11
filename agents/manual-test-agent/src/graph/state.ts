import { Annotation } from '@langchain/langgraph';
import type {
  Ambiguity,
  ContextItem,
  DuplicateCandidate,
  JiraStory,
  NormalizedCriterion,
  RequirementsAnalysis,
  ValidationReport,
} from '../schemas/domain.js';
import type { TestCase } from '../schemas/testcase.js';
import type { ErrorCategory } from '../shared/errors.js';
import type { CoverageSummary } from '../repositories/results.js';
import type { CoverageRecord } from '../schemas/domain.js';
import type { ModelInfo, ModelUsage } from '../models/types.js';

export type Phase = 'generate' | 'publish';

/** Terminal intent of a run. A set outcome routes the graph to `recordAuditOutcome`. */
export type Outcome = 'needs_clarification' | 'failed' | 'cancelled' | 'published';

export interface NodeFailure {
  node: string;
  category: ErrorCategory;
  message: string;
}

export interface UsageEntry extends ModelUsage {
  operation: 'analyze' | 'generate';
}

const last = <T>() => Annotation<T | undefined>();

/**
 * Explicit workflow state. Inputs are only identifiers; everything else is derived by nodes so that a
 * resumed run re-reads authoritative data from the database rather than trusting caller-supplied values.
 */
export const GraphStateAnnotation = Annotation.Root({
  jobId: Annotation<string>(),
  attempt: Annotation<number>(),
  phase: Annotation<Phase>(),

  issueKey: last<string>(),
  projectKey: last<string>(),
  requestedBy: last<string>(),
  correlationId: last<string>(),
  guidance: last<string>(),

  story: last<JiraStory>(),
  storyHash: last<string>(),
  context: last<{ items: ContextItem[]; degraded: string[]; droppedOutOfScope: number }>(),
  criteria: last<NormalizedCriterion[]>(),
  analysis: last<RequirementsAnalysis>(),
  ambiguities: last<Ambiguity[]>(),
  allowedReferences: last<Array<{ type: string; ref: string }>>(),

  testCases: last<TestCase[]>(),
  validation: last<ValidationReport>(),
  repairs: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  coverage: last<{ records: CoverageRecord[]; summary: CoverageSummary }>(),
  duplicates: last<DuplicateCandidate[]>(),
  modelInfo: last<ModelInfo>(),
  usage: Annotation<UsageEntry[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),

  draftVersion: last<number>(),
  clarificationQuestions: Annotation<string[]>({ reducer: (_a, b) => b, default: () => [] }),
  publicationId: last<string>(),

  outcome: last<Outcome>(),
  failure: last<NodeFailure>(),
});

export type GraphState = typeof GraphStateAnnotation.State;
export type GraphUpdate = typeof GraphStateAnnotation.Update;
export type NodeFn = (state: GraphState) => Promise<GraphUpdate>;

export const NODE_NAMES = [
  'authorizeRequest',
  'fetchJiraStory',
  'retrieveEnterpriseContext',
  'normalizeAcceptanceCriteria',
  'analyzeRequirements',
  'detectAmbiguities',
  'generateTestCases',
  'validateTestCases',
  'evaluateCoverage',
  'detectDuplicates',
  'persistDraft',
  'awaitHumanReview',
  'publishApprovedCases',
  'recordAuditOutcome',
] as const;
export type NodeName = (typeof NODE_NAMES)[number];
