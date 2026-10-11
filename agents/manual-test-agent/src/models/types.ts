import type {
  Ambiguity,
  ContextItem,
  NormalizedCriterion,
  RequirementsAnalysis,
  ValidationIssue,
} from '../schemas/domain.js';
import type { GeneratedTestCases } from '../schemas/testcase.js';

export interface ModelInfo {
  provider: string;
  modelId: string;
  promptVersion: string;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  attempts: number;
  estimatedCostUsd?: number | undefined;
}

export interface ModelResult<T> {
  value: T;
  usage: ModelUsage;
  model: ModelInfo;
}

export interface AnalysisInput {
  issueKey: string;
  summary: string;
  criteria: NormalizedCriterion[];
  context: ContextItem[];
  guidance?: string | undefined;
}

export interface GenerationInput extends AnalysisInput {
  analysis: RequirementsAnalysis;
  ambiguities: Ambiguity[];
  /** References the model may cite; anything else is rejected by validation. */
  allowedReferences: Array<{ type: string; ref: string }>;
  repairFeedback?: ValidationIssue[] | undefined;
}

/** Provider-neutral model port. The model only returns data; it has no tools and no side effects. */
export interface TestGenerationModel {
  readonly info: ModelInfo;
  analyzeRequirements(input: AnalysisInput): Promise<ModelResult<RequirementsAnalysis>>;
  generateTestCases(input: GenerationInput): Promise<ModelResult<GeneratedTestCases>>;
}
