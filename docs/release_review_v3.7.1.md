# Access-integrity patch review

The bounded source review covers candidate
`bc6bce90a6dac8d002324c67b840e762220fec52` against `v3.7.0` for the portable
package and `cloudflare-v0.13.0` for the reference runtime. The reviewed
release pair is `v3.7.1` and `cloudflare-v0.13.1`; publication receipts are
recorded below. Deployment remains a separate consumer act.

The fixed comparisons are:

```sh
git diff v3.7.0...bc6bce9
git diff cloudflare-v0.13.0...bc6bce9 -- packages/cloudflare
```

## Standards

No documented-standard breaches or actionable baseline smells were found in
the scoped diff. The review used `AGENTS.md`, the lexicon, the documented
compiler fences, and the portability invariants. It focused on the owned
claims snapshot, expiry parser, signer declaration, and Workers promise queue.
Tooling-enforced issues were left to the gates.

## Spec

No missing requirements, scope creep, or incorrect implementations were found
within those bounds. The review compared the original access-integrity plan
at `51d2d2c` with E1–E8, A5/A14, the normative access contract, and the upgrade
notes. It checked the snapshot before the asynchronous signature check,
the shared expiry gate and E4 order, the signer's declared algorithm, the
key-set compatibility witness, and queue release in `finally`.

Standards: 0 findings. Spec: 0 findings. This is a scoped code review, not an
independent security audit. The reviewers did not rerun the suites or replay
the historical red phases; those remain separate implementation evidence.
Getter/proxy/cyclic objects are outside the JSON input contract. A trusted
callback's algorithm declaration does not attest to its implementation.

## Consumer acceptance

Quartermaster reports no hold against `bc6bce9`, using a temporary local pin
override rather than a live deployment. Its report records 267 tenant tests,
28 ops tests, 13 portable access tests, and a clean typecheck. Its session
wiring consumes verified views read-only, its exhaustive failure mapping
still compiles, and its Workers use the same compatibility date and support
`Promise.withResolvers()`.

This is consumer-reported source integration evidence. Live runtime
acceptance, pin adoption, and deployment remain Quartermaster's acts after
publication. The relay reply is the coordination record; the ownership and
upgrade contracts remain in the architecture and migration documentation.

## Source preflight checks

The published production source, tests, and tracked `dist/` match the reviewed
commit. The differences are release documentation and package version metadata.

The source preflight passes `pnpm verify`: build freshness, compiler fences,
240 portable tests, examples, and 111 Cloudflare tests. `pnpm audit` reports
no known vulnerabilities across 0 production and 160 development dependencies.
`bin/check-artifact` validates the production configuration and bundles the
current Worker successfully. These preflight results do not replace the gates,
version checks, and publication performed by the release script.

## Publication receipts

Read-back on 2026-11-05 confirms that NAS, Codeberg, and GitHub advertise the
same annotated tag objects and peeled commits:

| Tag | Annotated tag object | Commit |
| --- | --- | --- |
| `v3.7.1` | `f6cfa509f868808ae6ad9bfd378a482702ed1067` | `8b8b392c5f31b19286ec1d49bc8835735e168792` |
| `cloudflare-v0.13.1` | `2a50a19c4970842e16dd1691628dcd84a077ded7` | `7ef5ec69227d27b49ce1ccec470fa247a42fa5e1` |

Both tags pass `bin/check-version`. `bin/check-artifact cloudflare-v0.13.1`
validates the tagged production configuration and successfully bundles its
Worker. NAS `main` points to the Cloudflare release commit. There is no mirror
lag for these tags.

The published comparisons are reproducible from the release tags:

```sh
git diff v3.7.0...v3.7.1
git diff cloudflare-v0.13.0...cloudflare-v0.13.1 -- packages/cloudflare
```

These receipts establish publication, not live deployment or consumer pin
adoption. Quartermaster owns those follow-up acts.

## Moshpit self-evaluation

- Lanes: two Terra reviewers, standards and spec; the orchestrator selected
  scope, checked central claims, and integrates the release evidence.
- Inline counterfactual: the small production diff fits one context; two
  independent interpretations are the main payoff.
- Overhead: two fresh briefs, overlapping reads, two short reports, and
  source verification; no helper pool or writer isolation was needed.
- Cost: two bounded reviewer turns; token cost was not measured.
- Context saved: independent standards/spec reading stayed out of the
  orchestrator's working context until the reports returned.
- Reading delegated: focused diff and contract review, not a helper census.
- Independent verification: both reviewers found no issue; neither replaces
  test or artifact evidence.
- Verification budget: central claims are checked against the source, with
  final build, suite, audit, and artifact results recorded for the candidate.
- Quality and verdict: useful independent release signoff with little
  throughput gain; roughly neutral at this diff size.
- Change to the skill: none.
