import type { SuperDocDocument } from '@superdoc/sdk';

/**
 * The orchestration logic behind the compare-and-apply workflow, isolated
 * from `SuperDocClient` so it can be exercised in tests without a live
 * SuperDoc host process. `index.ts` wires this to a real client; the test
 * file wires it to a scripted double shaped like the real result contracts
 * (the types below are derived from `SuperDocDocument` itself, so a fake
 * that satisfies them matches the real SDK contract).
 */

export type ComparisonDocument = Pick<SuperDocDocument, 'diff' | 'trackChanges'>;
export type ComparisonDiff = Parameters<SuperDocDocument['diff']['apply']>[0]['diff'];

export interface AppliedComparisonResult {
  appliedOperations: number;
  changeId: string;
}

/**
 * Reads `applyEligibility` before applying so an unsupported shape fails
 * closed with a clear reason instead of an opaque apply-time error, applies
 * the diff as a tracked change, and accepts the single review item reported
 * by that apply call. The receipt id avoids selecting an unrelated revision
 * that was already open in the base document.
 */
export async function applyComparisonAsTrackedChange(
  baseDoc: ComparisonDocument,
  diff: ComparisonDiff,
  outPath: string,
): Promise<AppliedComparisonResult> {
  const trackedEligibility = diff.applyEligibility?.tracked;
  if (trackedEligibility?.status !== 'candidate') {
    throw new Error(
      `Tracked apply is blocked for this pair: ${JSON.stringify(trackedEligibility?.blockers ?? [])}`,
    );
  }

  const applyResult = await baseDoc.diff.apply({ diff, changeMode: 'tracked' });

  const createdReviewItems = applyResult.operationReceipts.flatMap((receipt) =>
    receipt.disposition === 'review-created' ? receipt.reviewItems : [],
  );
  if (createdReviewItems.length !== 1) {
    throw new Error(`Expected exactly one compare-created review item, received ${createdReviewItems.length}.`);
  }
  const [createdReviewItem] = createdReviewItems;

  const decision = await baseDoc.trackChanges.decide({
    decision: 'accept',
    target: { kind: 'id', id: createdReviewItem.id },
    out: outPath,
    force: true,
  });
  if (!decision.success) throw new Error('The tracked-change decision did not confirm success.');

  return { appliedOperations: applyResult.appliedOperations, changeId: createdReviewItem.id };
}
