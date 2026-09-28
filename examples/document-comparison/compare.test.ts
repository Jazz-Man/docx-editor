import assert from 'node:assert/strict';
import test from 'node:test';
import { applyComparisonAsTrackedChange, type ComparisonDiff, type ComparisonDocument } from './workflow.ts';

function notUsedInThisTest(): never {
  throw new Error('not exercised by this workflow');
}

function baseDiffShape(): Omit<ComparisonDiff, 'applyEligibility'> {
  return {
    version: 'sd-diff-payload/v2',
    engine: 'superdoc-v2',
    baseFingerprint: 'fingerprint-base',
    targetFingerprint: 'fingerprint-target',
    coverage: { body: true, comments: false, styles: false, numbering: false, headerFooters: false },
    summary: {
      hasChanges: true,
      changedComponents: ['body'],
      body: { hasChanges: true },
      comments: { hasChanges: false },
      styles: { hasChanges: false },
      numbering: { hasChanges: false },
      headerFooters: { hasChanges: false },
      parts: { hasChanges: false },
    },
    payload: {},
  };
}

function candidateDiff(): ComparisonDiff {
  return {
    ...baseDiffShape(),
    applyEligibility: {
      direct: { status: 'candidate', blockers: [] },
      tracked: { status: 'candidate', blockers: [] },
    },
  };
}

function blockedDiff(): ComparisonDiff {
  return {
    ...baseDiffShape(),
    applyEligibility: {
      direct: { status: 'candidate', blockers: [] },
      tracked: {
        status: 'blocked',
        blockers: [{ code: 'structural-paragraph-unsupported', message: 'unsupported shape', families: ['body'] }],
      },
    },
  };
}

function fakeDocument(
  calls: string[],
  overrides: Partial<{ reviewIds: string[] }> = {},
): ComparisonDocument {
  const reviewIds = overrides.reviewIds ?? ['compare-created-1'];
  return {
    diff: {
      capture: notUsedInThisTest,
      compare: notUsedInThisTest,
      async apply(params) {
        calls.push(`apply:${params.changeMode}`);
        return {
          appliedOperations: 1,
          operationReceipts: reviewIds.map((id, index) => ({
            operationId: `operation-${index + 1}`,
            disposition: 'review-created' as const,
            reviewItems: [{
              id,
              story: { kind: 'story' as const, storyType: 'body' as const },
              address: { kind: 'entity' as const, entityType: 'trackedChange' as const, entityId: id },
            }] as [
              {
                id: string;
                story: { kind: 'story'; storyType: 'body' };
                address: { kind: 'entity'; entityType: 'trackedChange'; entityId: string };
              },
            ],
          })),
          baseFingerprint: 'fingerprint-base',
          targetFingerprint: 'fingerprint-target',
          coverage: { body: true, comments: false, styles: false, numbering: false, headerFooters: false },
          summary: {
            hasChanges: true,
            changedComponents: ['body'],
            body: { hasChanges: true },
            comments: { hasChanges: false },
            styles: { hasChanges: false },
            numbering: { hasChanges: false },
            headerFooters: { hasChanges: false },
            parts: { hasChanges: false },
          },
          diagnostics: [],
        };
      },
    },
    trackChanges: {
      list: notUsedInThisTest,
      get: notUsedInThisTest,
      async decide(params) {
        const id = 'id' in params.target ? params.target.id : '(bulk)';
        calls.push(`decide:${params.decision}:${id}:${params.out}:${params.force}`);
        return { success: true };
      },
    },
  };
}

test('applies and accepts a tracked change when the diff is a candidate', async () => {
  const calls: string[] = [];
  const doc = fakeDocument(calls);

  const result = await applyComparisonAsTrackedChange(doc, candidateDiff(), '/tmp/result.docx');

  assert.equal(result.appliedOperations, 1);
  assert.equal(result.changeId, 'compare-created-1');
  assert.deepEqual(calls, [
    'apply:tracked',
    'decide:accept:compare-created-1:/tmp/result.docx:true',
  ]);
});

test('fails closed without mutating when tracked apply is blocked', async () => {
  const calls: string[] = [];
  const doc = fakeDocument(calls);

  await assert.rejects(
    () => applyComparisonAsTrackedChange(doc, blockedDiff(), '/tmp/result.docx'),
    /Tracked apply is blocked/,
  );
  assert.deepEqual(calls, [], 'a blocked diff must never reach diff.apply or trackChanges.decide');
});

test('rejects an apply that creates no review item', async () => {
  const calls: string[] = [];
  const doc = fakeDocument(calls, { reviewIds: [] });

  await assert.rejects(
    () => applyComparisonAsTrackedChange(doc, candidateDiff(), '/tmp/result.docx'),
    /Expected exactly one compare-created review item, received 0/,
  );
  assert.deepEqual(calls, ['apply:tracked']);
});

test('does not guess when an apply creates more than one review item', async () => {
  const calls: string[] = [];
  const doc = fakeDocument(calls, { reviewIds: ['compare-created-1', 'compare-created-2'] });

  await assert.rejects(
    () => applyComparisonAsTrackedChange(doc, candidateDiff(), '/tmp/result.docx'),
    /Expected exactly one compare-created review item, received 2/,
  );
  assert.deepEqual(calls, ['apply:tracked']);
});
