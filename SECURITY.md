# Security policy

*How to report a vulnerability in `org-hats`, and what the maintainer commits
to. The canonical repository is <https://codeberg.org/rickhull/org-hats>; the
GitHub repository is a push-only mirror.*

## Supported versions

| Version | Supported |
| --- | --- |
| `v2.x` (from `v2.0.0`) | current release line; fixes land as a new tag |
| `cloudflare-v0.4.x` | current Cloudflare runtime line; separate cadence |
| `cloudflare-v0.3.x` | previous line; fixes land in the current line |
| `v1.x` (from `v1.0.0`) | frozen at its tags; no fixes |
| `v0.4.x` | frozen at its tags; no fixes |

Tags are immutable. A fix ships as a new version; a tag is never moved. The
v0.4 and v1 lines live at their tags; `main` is the v2 line.

## Reporting a vulnerability

**Do not open a public issue, pull request, or discussion.**

Use the private vulnerability-reporting channel offered by the canonical
Codeberg repository. If that channel is unavailable, contact the maintainer
through the Codeberg profile (<https://codeberg.org/rickhull>) to arrange a
private transfer. Do not report to the GitHub mirror; it is a copy.

Include:

- the affected tag or commit;
- the component — authority runtime, access verifier, envelope format,
  policy/read reach, conformance inventory, or packaging;
- a reproduction, or the smallest sequence that demonstrates the issue;
- the impact you believe it has; and
- any mitigation or patch you already have.

## Coordinated disclosure

- **Acknowledge** within three business days.
- **Triage** within ten business days, including severity and the affected
  versions.
- **Agree a disclosure date** with the reporter, fix and verify before public
  disclosure, and credit the reporter unless anonymity is requested.
- **Publish an advisory** with the fix and any operational guidance.

The deploying operator owns the product response for their deployment —
identity providers, secrets, binding configuration, and the choice of response
to each closed failure kind. `org-hats` coordinates on the library and its
release.

## Scope

In scope: the portable authority engine, the neutral access verifier, the
signed envelope format and fixed vectors, the policy/read-reach model, the
conformance inventory, and the build/package surface.

Out of scope: consumer product code, deployment configuration, identity
providers, the Cloudflare platform, and an operator's secret management. The
deploying operator owns those; report there as appropriate.

## Posture

The invariants a report may rely on:

- envelopes are Ed25519-signed over canonical JSON, versioned, and bounded by
  `iat`/`exp`; an unrecognized envelope format or version fails closed, and a
  call with an unrecognized interface version is refused before its body is
  interpreted;
- verification checks the format, the signature, expiry, and the caller's
  operation/site binding, in that order of trust;
- the authority engine owns signing, idempotency, audit, and refresh
  revocation; the access module is verification-only;
- verification keys are distributed to verifiers before the issuer uses them,
  and an old key is retired only after its last possible envelope expires;
- the portable source has no runtime dependencies and compiles with
  `types: []`; nothing under `src/` imports Cloudflare or Node-only types; and
- the failure taxonomy is closed: a new failure kind is an interface-version
  change, not an improvised error string.

A deviation from any of these is worth reporting, even without a working
exploit.
