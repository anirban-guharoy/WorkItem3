import { validateTestCases as validate } from '../../services/validation.js';
import { m } from '../../observability/telemetry.js';
import { requireField, type GraphDeps } from '../deps.js';
import type { NodeFn } from '../state.js';

export const validateTestCases =
  (_deps: GraphDeps): NodeFn =>
  async (state) => {
    const report = validate({
      testCases: requireField(state.testCases, 'testCases'),
      criteria: requireField(state.criteria, 'criteria'),
      allowedReferences: state.allowedReferences ?? [],
    });
    if (!report.valid) m.validationFailures.add(report.issues.filter((i) => i.severity === 'error').length);
    return { validation: report };
  };
