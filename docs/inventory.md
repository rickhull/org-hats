# The conformance inventory and where its story is told

*The inventory ships as `org-hats/conformance`; this page binds every case
to the document that tells its story. The binding is enforced by
`tests/docs.test.ts`: a new case fails the gate until it has a row here
with its title verbatim, a row naming a removed case fails the gate, a case
id cited in any doc must exist, and every twin id cited in the story docs
must exist in a fixture. `—` means the suites are the only telling; if you
write the story, replace it.*

| Id | Case | Told where |
| --- | --- | --- |
| OH-MODEL-01 | the professional twin is multi-organization and multi-site | [tutorial](tutorial.md) § The world we will use |
| OH-MODEL-02 | the festival is a bounded booth burst | [tutorial](tutorial.md) § The world we will use |
| OH-MODEL-03 | a site grant reaches the site and every team at it, never another site | [tutorial](tutorial.md) Case 2 · [walkthrough](walkthrough.md) §3 |
| OH-MODEL-04 | nothing reaches a whole operation | [tutorial](tutorial.md) Case 1 |
| OH-MODEL-05 | allow: the worn role carries the action and the grant reaches the target | [tutorial](tutorial.md) Case 1 |
| OH-MODEL-06 | deny/action-not-carried: the worn role does not carry the action | [tutorial](tutorial.md) Case 1 · [walkthrough](walkthrough.md) §3 |
| OH-MODEL-07 | deny/out-of-reach: no grant reaches the target | [tutorial](tutorial.md) Case 1 |
| OH-MODEL-08 | deny/not-admitted: unknown, disabled, or non-participating actors | [tutorial](tutorial.md) Case 1 |
| OH-MODEL-09 | fallback: a primary that does not reach the target stands aside | — |
| OH-MODEL-10 | read reach: granted-teams follows the actor's reached teams | [tutorial](tutorial.md) Case 1 · [walkthrough](walkthrough.md) §6 |
| OH-MODEL-11 | read reach: all-participating spans the operation | [tutorial](tutorial.md) Case 2 · [walkthrough](walkthrough.md) §6 |
| OH-MODEL-12 | read reach: a site grant reads every organization with a team at the site | [walkthrough](walkthrough.md) §6 |
| OH-AUTH-01 | evidence issues a signed envelope; verification yields neutral access | [tutorial](tutorial.md) Case 1 · [walkthrough](walkthrough.md) §4 |
| OH-AUTH-02 | one organization actor wears different hats in two operations | [tutorial](tutorial.md) Case 2 · [walkthrough](walkthrough.md) §3 |
| OH-AUTH-03 | unknown evidence is unauthenticated | [tutorial](tutorial.md) § Set up one world |
| OH-AUTH-04 | disable stops new issuance while the live envelope verifies to expiry | [tutorial](tutorial.md) Case 6 · [walkthrough](walkthrough.md) §9 |
| OH-AUTH-05 | refresh rotates the handle; a superseded handle is dead | [tutorial](tutorial.md) Case 5 · [walkthrough](walkthrough.md) §4 |
| OH-AUTH-06 | authentication method references ride the envelope and survive refresh | [tutorial](tutorial.md) Case 5 · [envelope](envelope.md) |
| OH-AUTH-07 | wearable hats carry the grant id select-hat takes | [tutorial](tutorial.md) Case 1 · [walkthrough](walkthrough.md) §7 |
| OH-ACT-01 | an unclaimed actor is claimed once and its subject then issues | [activation](activation.md) § Portable lifecycle |
| OH-ACT-02 | every unusable secret reports the same failure | [activation](activation.md) § Refusals |
| OH-ACT-03 | a subject linked elsewhere is refused without consuming the claim | [activation](activation.md) § Refusals |
| OH-ACT-04 | unlink ends issuance and a fresh subject can take the actor | [activation](activation.md) § Recovery commands |
| OH-ROSTER-01 | an administrator creates an actor once, without a link | [roster](roster.md) § Commands |
| OH-ROSTER-02 | a display name is presentation: set, visible, cleared | [roster](roster.md) § Display names |
| OH-ROSTER-03 | an unclaimed successor does not permit retirement | [roster](roster.md) § The usable successor |
| OH-ROSTER-04 | a linked successor takes over and the retired caller loses standing | [roster](roster.md) § The usable successor |
| OH-ROSTER-05 | disable remains the departing administrator's offboarding act | [roster](roster.md) § The usable successor |
| OH-PART-01 | invite, accept, admit: an invited organization receives a hat | — |
| OH-PART-02 | revoke is terminal: new issuance stops, the live envelope survives | [walkthrough](walkthrough.md) §9 |
| OH-CMD-01 | idempotent retry: a denial does not poison the key | [tutorial](tutorial.md) Case 4 · [walkthrough](walkthrough.md) §8 |
| OH-CMD-02 | request-access asks; it does not admit | [walkthrough](walkthrough.md) §8 |
| OH-CMD-03 | a grant stands on an actor and an active participation | [tutorial](tutorial.md) § The world we will use |
| OH-CMD-04 | a wearable hat is not an administrator's hat | [tutorial](tutorial.md) Case 4 · [walkthrough](walkthrough.md) §8 |
| OH-ACCESS-01 | wrong operation or site binding fails closed | [tutorial](tutorial.md) Case 1 · [walkthrough](walkthrough.md) §5 |
| OH-ACCESS-02 | expiry is bounded and fails closed | [tutorial](tutorial.md) § Where to run it · [walkthrough](walkthrough.md) §4 |
| OH-ACCESS-03 | unknown keys and tampered claims are invalid signatures | [envelope](envelope.md) |
| OH-ACCESS-04 | the envelope version pair gates reading; the interface version is provenance | [envelope](envelope.md) |
