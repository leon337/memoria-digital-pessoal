# PHASE-01 — Execution Report

## Result

`IN_REVIEW / READY_FOR_GATE`

Reviewed code HEAD: `07a41381f7bc47d9f048f90f3b36fcc6f85e03d1`  
Canonical reviewed-code CI: `31939889153` / job `95147424876` — PASS  
PR: `#2` — OPEN / NOT MERGED

## Delivered

The phase implemented the deterministic trusted-text vertical slice across contracts, domain, PostgreSQL/Prisma, NestJS HTTP, React PWA, architecture invariants and Playwright E2E.

The canonical path is:

```text
text
→ Memory + immutable Evidence
→ MEMORY_CREATED
→ deterministic Fact
→ CurrentFact
→ literal parameterized query
→ FOUND + provenance or UNKNOWN
```

## Task execution

1. Contracts/domain: shared limits and response contracts; pure deterministic record factory.
2. Schema: exact five-table Slice 01 migration and CI allowlist.
3. Persistence: atomic five-record transaction and rollback proof.
4. Retrieval: literal parameterized query, `%/_` literal semantics and stable ordering.
5. HTTP: create/get/query, safe 400/404/503 behavior and real outage proof.
6. Web: accessible store/query flows, explicit source, UNKNOWN and laboratory warning.
7. Validation: executable scope invariants and built-app browser E2E.
8. Review readiness: full-diff review, evidence, PRF and canonical state.

## Failures and recoveries

- Frozen-lock drift was caught by CI `31938251896`; a temporary branch-only workflow generated only `pnpm-lock.yaml` and was removed.
- Several commits were rejected by `format:check`; repairs used the repository's own Prettier and exact path allowlists.
- React tests exposed DOM contamination; global Testing Library cleanup was added.
- Review found a missing synthetic-only UI warning; fixed and tested.
- Review found copy drift from the approved plan; fixed and tested.
- Copy alignment made a Playwright label selector ambiguous; the selector was corrected to role-specific `textbox`/`searchbox`.
- The final selector correction itself was rejected by Prettier before tests; it was canonically formatted and rerun.

Every failure was captured before recovery; no failed validation was treated as success.

## Execution deviation D1 — rollback injection

The approved plan proposed a duplicate-Fact primary-key collision for the rollback test and also suggested mapping that failure through store-unavailability handling. Execution corrected this because a data-integrity conflict is not a database outage.

The final integration test injects a synthetic failure at the last `current_facts` insert using a temporary PostgreSQL trigger. It proves the required invariant more directly: after four earlier writes have occurred inside the transaction, the late failure rolls back all five Slice 01 records. The trigger/function are removed by test cleanup.

Classification: `REQUIRED_FOR_ACCEPTANCE` correction to test semantics; no scope expansion.

## Review

MESTRE full-diff technical review found:

- Important 1: synthetic-only boundary not visible in functional UI — FIXED.
- Important 2: web copy drifted from approved plan — FIXED.
- Critical findings: `0`.
- Open Important findings: `0`.

Independent Emily/MCF audit is not claimed. It remains a gate input.

## Safety

All test/product examples are synthetic. The application displays an explicit laboratory warning. Real sensitive data remains prohibited.

## Terminal boundary

No merge was performed. Slice 01 is not complete. Pilot and Slice 02 remain unauthorized.
