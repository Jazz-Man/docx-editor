# Document comparison

Compare two DOCX files and apply the result as a reviewable tracked change,
using the Document API's `diff.capture → diff.compare → diff.apply` workflow.
The included fixtures are synthetic, non-customer documents that differ by one
word ("buyer" → "purchaser") in a single sentence.

This is application code using the Node SDK. Copy this directory and adapt the
input documents and decision logic for your service. The example pins
`@superdoc/sdk` `2.16.0-next.8` (embedded `@superdoc/docx-engine`
`0.18.0-next.7`) so its behavior matches the support snapshot in the guide.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm start
```

`pnpm start` captures the target fixture's snapshot, compares it against the
base fixture, reads `applyEligibility` before applying, applies the diff as a
tracked change, accepts the exact compare-created review item identified by
the apply receipt, saves the result to `out/result.docx`, and reopens the
saved file to prove the accepted text persisted. The fixture deliberately
creates one review item. The helper refuses to guess if an adapted comparison
creates zero or multiple items; decide those receipt ids explicitly in the
order your application requires.

The live run requires the embedded SuperDoc host binary for your platform. A
plain `pnpm install` of this copied directory installs that published binary.

`pnpm test` exercises the orchestration logic in `workflow.ts` — the
`applyEligibility` gate, exact receipt-to-decision targeting, and the
fail-closed paths for blocked eligibility or an ambiguous receipt count —
against a scripted double of the SDK client, so it needs no live host and runs
in any environment. It proves this example's own control flow, not the
comparison engine's behavior; the engine's behavior for each shape in the [supported-case
matrix](https://docs.superdoc.dev/document-api/document-comparison#supported-case-matrix)
is covered by the Document API's own test suite.

Not every document pair is eligible for a tracked apply. See
[Compare and apply tracked changes](https://docs.superdoc.dev/document-api/document-comparison)
for the full workflow guide and the supported-case matrix. Support is scoped
to verified shapes: for example, plain first-comment creation and selected
field or retained-image cases are supported, while rich first-comment
creation, changed opaque drawing carriers, incomplete field topology, content
controls, and tracked header/footer topology changes still fail closed.
