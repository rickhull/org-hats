# The write side

*How a host writes grants: the transaction rule, the invariants statement by statement, and administration as an action. Documentation and reference SQL for a host's own migrations — deliberately not port surface.*

Settled at the write-side conference with the consumer: they asked for **documentation plus reference SQLite SQL that a host adapts in its own migration and transaction boundary** — not a generic write method. Their framing, adopted as the boundary: *writes are where dialect, transaction, and product policy become real; a generic port method would pretend otherwise.* The port stays two read questions. The reference adapter (`src/node.ts`) implements these checks read-then-write for the walkthroughs; what follows is what a host copies into its own transaction.

## The transaction rule

Every grant or revoke, and its audit row, is **one transaction** — no half-grants, no revoked hat without its record. The reference adapter runs under a single serialized writer, where read-then-write is safe; a host with concurrent writers wraps each statement in its database's transaction (D1: a `batch`). That is the whole atomicity contract.

## Grant — the insert and its preconditions

```sql
-- inside one transaction:
--   1. team xor scope                       (schema CHECK; check first for a clean error)
--   2. the employer rule                    (below — read the team's organization)
--   3. one primary / one default per employment   (partial unique indexes enforce)
--   4. first grant in an organization is primary  (read-then-write — SQL cannot require a row)
INSERT INTO grant (id, actor_id, role_id, organization_id, team_id, scope_id, is_primary, is_default)
VALUES (?, ?, ?, ?, ?, ?, ?, ?);
--   5. the audit row, same transaction
```

- **Team xor scope.** `CHECK ((team_id IS NULL) <> (scope_id IS NULL))`; the reference adapter refuses both-neither and both-before insert so the error names the mistake.
- **The employer rule, stated precisely.** For a team-bound grant, `grant.organization_id = team.organization_id`. This refuses exactly one thing — a grant whose *employer* is not the organization fielding the team. It does **not** refuse actors who hold team grants in several organizations: that is legitimate and ordinary (the walkthroughs' Ellis volunteers for the Council and runs a cart for Long Table). Do not harden this audit finding into a generic cross-organization refusal — the refused thing is the mismatch, never the spanning.
- **One primary, one default per employment.** The partial indexes `grant_one_primary` / `grant_one_default` key on `(actor, organization)` here. A host whose employment is keyed per *operation* instead may key the indexes on the operation — a consumer's shape; the model is indifferent. The invariant is *one landing hat per employment*, wherever the host draws employments.
- **The first grant is the primary.** A read-then-write check (no constraint can require a row to exist): if the actor holds no grant in this employment yet, the insert sets `is_primary = 1`.
- **Role/subject pairing is application policy — assert it as a probe, never a CHECK.** A CHECK could say "role X takes a team" only by *naming* roles, and a role the schema names is not opaque. The failure is mild: a role held over the wrong kind of subject reaches nothing its capabilities apply to — meaningless, not dangerous. Audit, don't constrain.

## Revoke — the delete

```sql
DELETE FROM grant WHERE id = ?;
-- the audit row, same transaction: who revoked, what, when, why
```

Revocation needs no ceremony beyond the row — rule 7 (re-validation on every request) makes the next request refuse the hat. One delete, one row, immediate.

## Primary and default — the updates

Two `UPDATE`s inside the same partial-unique invariants: setting a new primary clears the old within the employment, likewise the default. Nothing else moves; hats are never rewritten, only superseded.

## Insert order under enforced foreign keys

**scopes → organizations → teams → actors → grants.** D1 enforces foreign keys; the reference turns them on explicitly (`PRAGMA foreign_keys = ON`). A consumer's onboarding tool is deliberately ordered this way, and its upserts **add** grants and never silently revoke — re-running onboarding grows the directory; only an explicit revoke shrinks it.

## Administration is an action (demonstrated)

Who may grant is not a concept — it is a `decide` call like any other:

```ts
decide(repo, {
  actorId: admin, operationId,
  scopePath: site,            // the act's target is *where* —
  action: "grant",            // a capability like any other —
  organizationId: employer,   // and the employer rule, restated for the granter
})
```

One nuance the demonstration surfaced, worth keeping: the act's target is the **site**, not the team. `reach` never lets a scope-bound hat reach a team target — that asymmetry is deliberate (a team-bound supervisor at one site does not reach the same-named team at another, OH-QM-02) — and it is right for granting too: an administrator's authority is *a place and an employer* ("may grant within Big Park for the Council"), while *which team, which role* are the write's invariants above. The festival walkthrough proves the shape three ways: a festival-scoped Council Admin allowed at a site; a crew member reaching but refused for lacking the action (`no-capability`); an admin hat refused at a site it does not cover (`not-admitted`).

The consumer gates granting as a planned, separate capability — not under its configure verb — and both choices are the same shape: an action, a reach, an employer. ARBAC97 lands as data.

## What this deliberately is not

Not a port method, not an admin API, not product policy. The host owns its writes, its dialect, and its transaction boundary; this document is the checklist the host owns them against.
