import { PROMPT_VERSION } from '../prompts/index.js';
import type { RequirementsAnalysis } from '../schemas/domain.js';
import type { GeneratedTestCases, TestCase } from '../schemas/testcase.js';
import { tokens } from '../shared/text.js';
import { truncate } from '../shared/text.js';
import type { AnalysisInput, GenerationInput, ModelInfo, ModelResult, TestGenerationModel } from './types.js';

const NEGATIVE = /\b(not|only|reject\w*|invalid|locked|cannot|must not|fail\w*|unauthori[sz]ed|exceed\w*)\b/i;
const AUTHZ = /\b(role|administrator|admin|permission|authori[sz]ed|only)\b/i;

/** Deterministic stand-in for the LLM: same input, same output; no network. */
export class FakeTestGenerationModel implements TestGenerationModel {
  readonly info: ModelInfo = {
    provider: 'fake',
    modelId: 'fake-deterministic-1',
    promptVersion: PROMPT_VERSION,
  };
  readonly calls = { analyze: 0, generate: 0 };
  /** Test hook: mutate the generated cases (e.g. to simulate bad model output). */
  mutate?: (cases: TestCase[], input: GenerationInput) => TestCase[];

  async analyzeRequirements(input: AnalysisInput): Promise<ModelResult<RequirementsAnalysis>> {
    this.calls.analyze += 1;
    return {
      value: {
        summary: truncate(`Story ${input.issueKey}: ${input.summary}`, 1000),
        testableBehaviours: input.criteria.map((c) => ({
          criterionId: c.id,
          behaviour: truncate(c.text, 400),
        })),
        missingRequirements: [],
        ambiguities: [],
      },
      usage: { inputTokens: 100, outputTokens: 50, latencyMs: 1, attempts: 1, estimatedCostUsd: 0 },
      model: this.info,
    };
  }

  async generateTestCases(input: GenerationInput): Promise<ModelResult<GeneratedTestCases>> {
    this.calls.generate += 1;
    let n = 0;
    const id = () => `TC-${String(++n).padStart(3, '0')}`;
    const cases: TestCase[] = [];
    const jiraRef = input.allowedReferences.find((r) => r.type === 'jira');

    for (const c of input.criteria) {
      const ambiguity = input.ambiguities.find((a) => a.criterionId === c.id);
      const cTokens = new Set(tokens(c.text));
      const refs = [
        ...(jiraRef ? [{ type: 'jira' as const, ref: jiraRef.ref }] : []),
        ...input.context
          .filter((ctx) => tokens(`${ctx.title} ${ctx.snippet}`).some((t) => cTokens.has(t)))
          .slice(0, 1)
          .map((ctx) => ({ type: ctx.type, ref: ctx.id })),
      ].filter((r) => input.allowedReferences.some((a) => a.type === r.type && a.ref === r.ref));
      const base = {
        acceptanceCriteriaIds: [c.id],
        sourceReferences: refs,
        assumptions: ambiguity
          ? [`Interpretation of "${truncate(ambiguity.description, 150)}" is assumed and needs confirmation.`]
          : [],
        requiresClarification: Boolean(ambiguity),
        clarificationQuestions: ambiguity ? [ambiguity.question] : [],
        preconditions: ['The tester has access to a test environment with the feature enabled.'],
        testData: [],
      };
      const text = truncate(c.text, 300);
      cases.push({
        ...base,
        id: id(),
        title: truncate(`Verify ${c.id}: ${text}`, 190),
        objective: `Confirm that the system satisfies ${c.id}: ${text}`,
        testType: 'positive',
        priority: cases.length === 0 ? 'critical' : 'high',
        steps: [
          {
            stepNumber: 1,
            action: `Set up the scenario described by ${c.id}: ${text}`,
            expectedResult: 'The scenario is ready and no error is shown.',
          },
          {
            stepNumber: 2,
            action: `Perform the user action required by the criterion: ${text}`,
            expectedResult: `The observed behaviour matches the criterion: ${text}`,
          },
        ],
        expectedOutcome: `The system behaves as specified: ${text}`,
      });
      if (NEGATIVE.test(c.text)) {
        cases.push({
          ...base,
          id: id(),
          title: truncate(`Verify ${c.id} negative path: ${text}`, 190),
          objective: `Confirm that invalid or disallowed input is handled for ${c.id}`,
          testType: AUTHZ.test(c.text) ? 'authorization' : 'negative',
          priority: 'high',
          steps: [
            {
              stepNumber: 1,
              action: `Prepare input or a user that violates the condition in ${c.id}: ${text}`,
              expectedResult: 'The violating input or user is ready.',
            },
            {
              stepNumber: 2,
              action: `Attempt the operation covered by the criterion: ${text}`,
              expectedResult: `The system rejects or restricts the operation as stated: ${text}`,
            },
          ],
          expectedOutcome: `The disallowed operation is blocked and the specified message or restriction is observed: ${text}`,
        });
      }
      const num = /\b(\d{1,6})\b/.exec(c.text)?.[1];
      if (num) {
        cases.push({
          ...base,
          id: id(),
          title: truncate(`Verify ${c.id} boundary around ${num}: ${text}`, 190),
          objective: `Check behaviour at the limit of ${num} for ${c.id}`,
          testType: 'boundary',
          priority: 'medium',
          testData: [{ name: 'limit', value: num }],
          steps: [
            {
              stepNumber: 1,
              action: `Use a value just below the limit of ${num} for: ${text}`,
              expectedResult: `Behaviour below the limit matches the criterion: ${text}`,
            },
            {
              stepNumber: 2,
              action: `Use a value exactly at and just above the limit of ${num} for: ${text}`,
              expectedResult: `Behaviour at and above the limit matches the criterion: ${text}`,
            },
          ],
          expectedOutcome: `Limit ${num} is enforced exactly as specified: ${text}`,
        });
      }
    }
    const out = this.mutate ? this.mutate(cases, input) : cases;
    return {
      value: { testCases: out.slice(0, 60) },
      usage: { inputTokens: 400, outputTokens: 600, latencyMs: 1, attempts: 1, estimatedCostUsd: 0 },
      model: this.info,
    };
  }
}
