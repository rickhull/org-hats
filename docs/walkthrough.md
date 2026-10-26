# Walkthrough: the same story, told plainly

*A friendlier companion to [`tutorial.md`](tutorial.md). No code to run, no
model to review — just what this system does, in the words a first-time
reader needs. Every example is synthetic design data. When this page and a
test disagree, the test is right; when a word needs precision,
[`lexicon.md`](lexicon.md) wins.*

Three short comments close every section — one from each reader in
[`personas.md`](personas.md): **the practitioner** (runs directories and
servers for a living), **the academic** (studies access control), and **the
onlooker** (a junior developer or a manager deciding whether to spend a
meeting on this). Their voices are the reader's three instincts, not
marketing.

## 1. The problem: who may do what, where

One person often works in several places at once. Dana works for a
logistics company; that company lends her to a field-services operation,
and on weekends she helps run a festival. At the field-services operation
she reviews and resolves work orders for one crew at one yard. At the
festival she administers a whole gate. Same person, same employer —
different authority in each place.

Most permission systems answer "what is Dana allowed to do" with one flat
answer that follows her everywhere, or with a pile of per-system settings
nobody can audit. The question this system answers instead is:

```text
may act = the hat she is wearing carries the action × that hat reaches the place
```

Not "is Dana an admin," but "is Dana wearing a hat that may do *this*,
*here*, right now."

> **The practitioner says:** this is the ticket I get every week — "why is
> this user in this group?" — except the answer is one checkable row
> instead of a forest of nested groups.
>
> **The academic says:** scoped role activation: the role exists only
> attached to a target, and the binding is evaluated per act, not per
> person.
>
> **The onlooker says:** so "admin" isn't a property of the person — it's a
> property of a job they were given somewhere. That already sounds more
> honest.

## 2. The words, in plain English

| Word | Plain meaning |
| --- | --- |
| **organization** | A company or group — Dana's employer is one. |
| **operation** | A joint effort organizations participate in: the field-services operation, the festival. |
| **site** | A physical place an operation runs: a yard, a gate, an airfield. |
| **team** | A working group at one site: Dana's yard crew. |
| **actor** | A person within one organization. Dana is an actor of her employer. |
| **grant** | One assignment, in full: this actor, this role, this one target. Written down and auditable. |
| **hat** | A grant worn for a session. You wear exactly one action hat at a time. |
| **reach** | What a grant's target covers. A team grant covers that team; a site grant covers every team at that site. |
| **envelope** | The signed, short-lived badge the authority issues for a session — see §4. |
| **read board** | The list of organizations whose work you can *see* (as opposed to act on). |

Two habits to keep: a role never exists without a target, and *seeing* is
never the same as *doing*.

> **The practitioner says:** replace "grant" with "that one ACL row I can
> actually point at," and "hat" with "which row is active in this session,"
> and you already know this model.
>
> **The academic says:** assignment is factorized — role × scope — which is
> the interesting structural choice here; hierarchy and inheritance are
> deliberately absent.
>
> **The onlooker says:** "hat" sounded cute until the table made it
> precise. Fine — one word per real distinction.

## 3. Dana's two hats

At Meridian Field Services, Dana's employer participates, and Dana holds
one grant: *coordinator* over the *Yard crew* team at *West Yard*. The
coordinator role carries exactly two actions, *review* and *resolve*. Not
*observe* — if she needs to observe, someone edits the policy; the system
never guesses.

At Riverbend Fest, the same employer participates, and Dana holds a
different grant: *admin* over the *Park Gate* site. Because the target is a
site, her hat reaches every team at that gate — including teams that belong
to other organizations. She can also *configure* the gate, because the
admin role there carries the configure action.

What she can never do is carry one operation's authority into the other.
Her festival hat does not exist at Meridian. There is no global role, no
inheritance, no "Dana is a level 3." There are two grants, each living
inside one operation, each wearing only when she works there.

> **The practitioner says:** no global groups, no nesting, no lateral
> movement between directories. Each operation is its own namespace, and
> that's the part I'd defend in an audit.
>
> **The academic says:** two policies, two scopes, one subject — and the
> interesting claim is that nothing composes across them by accident.
>
> **The onlooker says:** this is the slide version: one person, two jobs,
> and the computer always knows which job is asking.

## 4. The badge and its expiry

When Dana signs in to an operation, the authority issues her an **envelope**:
a signed badge that states who she is, which hat she is wearing, what that
hat reaches, what she may configure, and what her read board is. It also
states when it expires — envelopes are short-lived by configuration,
typically minutes.

The honest part: a badge already in someone's hands cannot be magically
recalled. Nobody's can — that is physics, not a limitation unique to this
system. So instead of pretending otherwise, the system keeps the badge's
life short and says plainly: inside the window, the badge speaks; after it,
the badge is paper.

To keep a session going past one badge, the host refreshes it — the old
refresh handle dies after one use, and the new badge carries fresh facts.
(What "refresh" can and cannot rescue is §9's story.)

> **The practitioner says:** short-lived signed tokens, verifier-side
> public key — this is the Kerberos-shaped idea my systems already trust,
> minus the ticket lifecycle I have to babysit.
>
> **The academic says:** an offline-verifiable authorization artifact with
> a bounded validity window — capability-like in portability, though the
> model does not claim capability semantics.
>
> **The onlooker says:** so "logging out everywhere" isn't a thing here —
> "everywhere" is really "until it expires, minutes later." I'd rather be
> told that than sold perfect revocation.

## 5. Checking the badge at the door

Every service that needs to check Dana does it itself, on the spot, with a
public key — no call back to the authority, no shared database. The check
is a handful of plain questions:

- May the holder *review* the Yard crew? — Yes: the hat carries review, and
  the hat reaches that team.
- May the holder *observe* the Yard crew? — No: the role does not carry it.
- May the holder *review* a team at East Hall? — No: out of reach.
- May the holder do anything to the whole operation? — No: nothing reaches
  a whole operation.
- Is this badge for *this* building? — The door names the operation and
  site it is guarding; a perfectly valid badge for somewhere else simply
  does not match.

A yes is a yes. A no is a plain answer, not an exception to catch — and
"no" has reasons (*doesn't carry the action*, *out of reach*, *not part of
this operation*, *expired*, *wrong place*), so the host can tell the person
something useful.

> **The practitioner says:** verification without a directory lookup means
> the app survives the authority being down, and the denial reasons map to
> sentences I can actually put in a UI.
>
> **The academic says:** decision point and policy point are cleanly
> split; the verifier evaluates signed facts and never re-derives policy.
>
> **The onlooker says:** the door doesn't phone anyone. That's either
> terrifying or obvious — and the expiry window from §4 is why it's safe
> enough.

## 6. Seeing is not doing

Alongside what you may *do*, every badge carries a **read board**: the
organizations whose work you may *see*.

The operation decides how broad that is, and the two examples differ on
purpose. At Meridian, Dana sees her own organization — the one behind the
team she works. At Riverbend, the festival chose the wide setting: everyone
participating sees everyone. Same Dana, different boards — because the
board is the operation's policy, not a property of the person.

The important wrinkle: reach can cross organizations. A site grant at the
festival gate reaches teams from other companies, so Dana can *work with*
people her employer doesn't employ. When a crossed grant lands her a team
whose organization is not on her board, that team travels on the badge as
an explicit exception — nothing is silently widened.

> **The practitioner says:** the read board is the thing flat "viewer"
> roles always got wrong for me — here it's computed by the issuer and
> just compared by the door.
>
> **The academic says:** read reach is issuer-computed and carried as
> signed claims; the separation between act reach and read reach is the
> distinction to cite.
>
> **The onlooker says:** "she can see the schedule but can't touch the
> crane" is apparently a first-class concept, not two half-configured
> flags.

## 7. Switching hats

An actor can hold several grants in one operation — two teams, or a team
and a site. The session's presentation read lists every hat they could
wear: role, what it carries, where it reaches, and whether it's the one in
force. As of release 2.2.0, each listed hat also carries its **grant id** —
the exact handle the switch command takes. A host renders that list as a
menu; the actor picks; the host sends *switch to grant such-and-such*; the
next badge is issued wearing the new hat.

The switch is the actor's own choice, over their own hats — nobody can
switch someone else's, and a hat that was revoked or doesn't exist is
simply refused. Between the switch and the next refresh, the old badge
keeps its old hat: a hat change lands at the next badge, never retroactively
inside a live one.

> **The practitioner says:** the context call hands my UI everything —
> names, sites, the hat list with the ids to act on. I don't join anything
> against the directory to draw the menu.
>
> **The academic says:** one active capacity per session, selected by the
> subject, addressed by assignment id — the activation is explicit, not
> ambient.
>
> **The onlooker says:** it's a profile switcher, like the account
> switcher in my mail app — except each profile carries real authority,
> so the ids matter.

## 8. Asking for changes

Changes — granting a hat, revoking one, inviting an organization, disabling
an actor — are **commands**: typed requests that name exactly one act,
carry who is asking, and come back with a plain receipt.

Three properties make them unexciting, which is the point:

- **A denial is a normal answer.** Dana the coordinator cannot grant hats;
  she asks, the system says *denied — you do not administer this
  operation*, and nothing changes. No exception, no half-write.
- **Asking twice is safe.** Every command carries the caller's intent key.
  Send the same request twice — a double-click, a retry after a network
  blip — and the second one simply confirms the first. Nothing happens
  twice.
- **Asking is not being let in.** Someone new who wants in files an access
  request with a note; it sits in a queue until an administrator — a
  person — admits them. The request is a question, never a stored
  permission.

> **The practitioner says:** idempotency keys and value-shaped failures —
> this is the request/retry hygiene I keep having to build by hand, in one
> place, already tested.
>
> **The academic says:** administrative operations are first-class and
> reviewable; the request/admission split keeps solicitation distinct from
> authorization.
>
> **The onlooker says:** "the double-click does nothing twice" is the
> sentence I'll remember. And a person still says yes or no.

## 9. When someone leaves

Dana's colleague Sam administers their organization. When Dana leaves, Sam
disables her. Two honest things happen, in order:

1. **The refresh gate closes immediately.** Her next attempt to get a new
   badge is refused — even if the internal message about her disable is
   momentarily lost in flight, the gate asks the owner of the fact before
   it renews anyone. A lost message delays a notification; it cannot extend
   a session.
2. **The badge in her hands lives out its window.** Until it expires —
   minutes — it still verifies. The system does not pretend to recall it;
   it makes sure no new one is issued and the old one dies on schedule.

That is the whole trade, stated instead of hidden: offline-verifiable
badges in exchange for a short, bounded window in which a departure is
still effective in the field. The window is configuration, and it is the
number to point at when someone asks "how fast is offboarding."

> **The practitioner says:** this is the question I'd ask first. "The
> answer is a bounded number of minutes, by configuration" is an answer I
> can take to management.
>
> **The academic says:** revocation semantics are bounded-window by
> design — no instant-recall claim is made, and the liveness read at
> refresh is the deliberate single exception to the no-cross-reads rule.
>
> **The onlooker says:** they told me the bad part before I found it.
> That's most of why I'd keep reading.

## 10. The same rules, deployed

Everything above is the portable core; it runs unchanged as a deployed
service (a Cloudflare reference runtime exists) and as an in-memory engine
for examples and tests. The deployed shape adds no second set of rules —
the same conformance inventory runs against both, which is what keeps
"reference" honest. Deployment, hostnames, and product objects remain the
consuming host's job; this system is the organizational half of
authorization.

**Where to go next, by temperament:**

- Want to *run* one case? `node examples/pilot.ts`, then
  `node examples/own-world.ts`.
- Want the real walkthrough with code and every id?
  [`tutorial.md`](tutorial.md).
- Coming from Active Directory or LDAP? [`from_ldap.md`](from_ldap.md).
- Want the model mapped to the literature? [`model_mapping.md`](model_mapping.md).
- Want the architecture and the invariants?
  [`authority_redesign.md`](authority_redesign.md), then
  [`../specs/`](../specs/).
- Want what this system *does not* claim?
  [`positioning.md`](positioning.md) § Current limits — read it before
  repeating any claim from this page.

> **The practitioner says:** start with the pilot example and the LDAP map;
> come back for the tutorial when the ids start making sense.
>
> **The academic says:** skip to the architecture and the conformance
> inventory; the claims are there, with the non-claims beside them.
>
> **The onlooker says:** I got the story. If we take a meeting, it starts
> with the limits page — and the one-line rule from §1.
