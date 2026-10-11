import { detectDuplicates as detect } from '../../services/duplicates.js';
import { m } from '../../observability/telemetry.js';
import { requireField, type GraphDeps } from '../deps.js';
import type { NodeFn } from '../state.js';

/** Flags candidates for the reviewer; nothing is discarded automatically. */
export const detectDuplicates =
  (deps: GraphDeps): NodeFn =>
  async (state) => {
    const existing = (state.context?.items ?? []).filter(
      (i) => i.type === 'test_case' && !i.suspectedInjection,
    );
    const duplicates = detect(
      requireField(state.testCases, 'testCases'),
      existing,
      deps.config.DUPLICATE_SIMILARITY_THRESHOLD,
    );
    if (duplicates.length) m.duplicatesFlagged.add(duplicates.length);
    return { duplicates };
  };
