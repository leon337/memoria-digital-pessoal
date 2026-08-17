# SLICE 02 — Correction & History

## Mission

`MDP-001 — Memória Digital Pessoal`

## Status

`COMPLETE / DELIVERED / MERGED / POST-MERGE VALIDATED`

Slice 02 is integrated into `main`. The authorized final branch HEAD passed full CI before merge, PR #4 was merged, and the resulting merge commit passed the same full CI on `main`.

## Boundary

Slice 02 extends the trusted textual memory boundary with append-only correction and history:

```text
current textual fact
→ correction request with expectedCurrentFactId
→ immutable correction Evidence
→ immutable MEMORY_CORRECTED event
→ new Fact with explicit supersedesFactId
→ atomic CurrentFact reprojection
→ normal query reads current only
→ history reconstructs original → corrections → current
```

## Authorized design

LEANDRO approved the Slice 02 design and written specification on `2026-08-17`, authorized implementation, and later granted explicit HUMAN_GATE/merge authorization with `AUTORIZO` on `2026-08-17`.

The runtime did not expose independent Emily/LÉO execution. Those gates are not claimed as performed; LEANDRO's explicit authorization was recorded as a scoped final-human-authority override for PR #4 only.

Canonical design/specification:

- `docs/superpowers/specs/2026-08-17-slice-02-correction-history-design.md`
- `docs/superpowers/plans/2026-08-17-slice-02-correction-history.md`

## Delivered scope

- full-text corrections only;
- immutable original Evidence and Facts;
- new immutable Evidence, Fact and `MEMORY_CORRECTED` event for every accepted correction;
- explicit `supersedesFactId` lineage;
- optional correction reason, maximum 500 characters;
- blank and no-change correction rejection without writes;
- optimistic concurrency through `expectedCurrentFactId`;
- stale corrections rejected without silent overwrite;
- atomic PostgreSQL correction transaction with stable Memory-row lock;
- current-state projection updated without changing original `recordedAt`;
- history reconstructed by explicit lineage rather than timestamps;
- uncorrected memory history with one original/current version;
- undo/restore implemented as a new append-only correction using prior text;
- normal literal queries return only current state;
- HTTP correction/history endpoints with stable 404/409/422/503 envelopes;
- typed web API client with no automatic retry;
- PWA inline correction, optional reason, success feedback, stale blocking and inline history;
- responsive history/correction controls;
- browser E2E for correction, current-only retrieval, history and append-only restore;
- real PostgreSQL outage proof for correction returning safe `503 SERVICE_UNAVAILABLE`;
- physical migration checks for correction lineage and ledger constraints.

## Final technical checkpoint

- Pull request: `#4 — SLICE 02: correction and history` — CLOSED / MERGED.
- Final authorized branch HEAD: `524c9fe8f449dc2285e4ec2979d66f15d045256e`.
- Final branch CI: `32002842343` / job `95306384754` — PASS.
- Merge commit: `fcd6b8106d4a033bd91f2ee5e51ef1378458362c`.
- Post-merge `main` CI: `32003011383` / job `95306867027` — PASS.
- Automated tests: `95/95` PASS across `25` test files.
- Browser E2E: `3/3` PASS.
- Exact product tables: `current_facts,evidence,facts,ledger_events,memories`.
- Physical correction schema check: `fact_lineage_column=1 fact_lineage_unique=1 ledger_columns=3 correction_check=1`.
- Database outage: live `200`, ready `503`, memory create `503`, correction `503 SERVICE_UNAVAILABLE` with safe envelope.
- Slice 01 and Slice 02 PRF manifests: PASS.

## TDD/review outcome

The implementation was built in task-level RED→GREEN cycles. A late technical review found one UX defect: the accessible `Correção salva` confirmation was cleared when `QueryMemoryForm` published the newly corrected `factId`. A test-only RED commit reproduced the problem, then a minimal `useRef`-based fix preserved feedback only for the component's own current-state publication while fresh external queries still reset local state.

- UX RED commit: `1218f03805cca35b3e447d123b18869adbbd3282`.
- UX RED CI: `32000553631` / job `95299911316` — expected failure.
- UX fix commit: `361214e97e9b70df7092ee1f6d5c3944446edda0`.
- GREEN CI: `32000681041` / job `95300284264` — 95/95 tests and 3/3 E2E passed.

## Explicitly not delivered or authorized

- deletion or purge;
- date, temporal precision, entity or metadata correction;
- offline/local-first persistence;
- synchronization or distributed-conflict resolution;
- semantic retrieval, embeddings or pgvector;
- generative AI or AI extraction;
- voice/STT/TTS;
- reminders/proactivity;
- advanced authentication/recovery/encryption hardening;
- backup/restore/purge workflows;
- real sensitive data;
- controlled pilot;
- Slice 03 implementation.

## Governance closeout

HUMAN_GATE was granted and consumed for PR #4. The merge succeeded and post-merge `main` validation passed. The pre-gate PRF remains frozen as historical evidence; no independent Emily/LÉO execution is retrospectively fabricated.

## Next action

None for Slice 02. Return to the roadmap boundary. Slice 03 requires separate definition and authorization.