import { evaluateCoverage as evaluate } from '../../services/coverage.js';
import { m } from '../../observability/telemetry.js';
import { requireField, type GraphDeps } from '../deps.js';
import type { NodeFn } from '../state.js';

export const evaluateCoverage =
  (deps: GraphDeps): NodeFn =>
  async (state) => {
    const coverage = evaluate(
      requireField(state.criteria, 'criteria'),
      requireField(state.testCases, 'testCases'),
      state.ambiguities ?? [],
      { covered: deps.config.COVERAGE_COVERED_THRESHOLD, partial: deps.config.COVERAGE_PARTIAL_THRESHOLD },
    );
    m.coveragePercent.record(coverage.summary.coveragePercent);
    return { coverage };
  };
