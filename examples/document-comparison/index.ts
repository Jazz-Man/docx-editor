import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SuperDocClient } from '@superdoc/sdk';
import { applyComparisonAsTrackedChange } from './workflow.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const basePath = path.join(here, 'fixtures/base.docx');
const targetPath = path.join(here, 'fixtures/target.docx');
const outDir = path.join(here, 'out');
const outPath = path.join(outDir, 'result.docx');
await mkdir(outDir, { recursive: true });

// 1. Capture the target document's diffable snapshot.
const targetClient = new SuperDocClient();
const targetDoc = await targetClient.open({ doc: targetPath });
const targetSnapshot = await targetDoc.diff.capture();
await targetDoc.close();
await targetClient.dispose();

// 2. Compare the base document against that snapshot.
const baseClient = new SuperDocClient();
const baseDoc = await baseClient.open({ doc: basePath });
const diff = await baseDoc.diff.compare({ targetSnapshot });
console.log('Changed components:', diff.summary.changedComponents);
console.log('Tracked apply eligibility:', diff.applyEligibility?.tracked);

// 3. Read applyEligibility, apply the diff as a tracked change, and accept
// the one review item identified by the apply receipt. Nothing is mutated if
// eligibility was 'blocked'; unsupported shapes fail closed instead.
const { appliedOperations, changeId } = await applyComparisonAsTrackedChange(baseDoc, diff, outPath);
console.log('Applied operations:', appliedOperations);
console.log('Accepted tracked change:', changeId);

// The decision above already wrote the accepted result to outPath via its
// own out/force. The live session still carries that mutation as unsaved
// state, so close it with discard instead of requiring a second save to the
// same bytes.
await baseDoc.close({ discard: true });
await baseClient.dispose();

// 4. Reopen the saved DOCX to prove the accepted change persisted.
const reopenClient = new SuperDocClient();
const reopenDoc = await reopenClient.open({ doc: outPath });
const finalText = await reopenDoc.getText();
console.log('Reopened document text:', finalText);
if (!finalText.includes('purchaser')) {
  throw new Error('Expected the accepted change to persist through save/reopen.');
}
await reopenDoc.close();
await reopenClient.dispose();

console.log('Done. Saved reviewed result to', outPath);
