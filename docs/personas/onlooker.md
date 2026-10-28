# The one-pager — for someone deciding whether this is worth a meeting

*You are not being asked to adjudicate a model. This page exists so you don't
have to read one. If you want more after this, the README opening and
[`../positioning.md`](../positioning.md) are the next stop — not the specs.*

## The problem, in one story

Dana is a coordinator over the Yard crew at West Yard. She may review and
resolve things there, but has no reach at East Hall. At a festival the same
Dana wears an admin role over a different gate. One person, two jobs, two
different sets of keys — and the system that decided this never had to trust
"Dana is in the right group," because it checked the specific role for the
specific place.

## The rule, in one line

> A person may act only if the role they are currently using carries that
> action, and the grant behind it reaches the specific place they are acting
> on.

## Why this is interesting, not just technical

- **One identity, many hats.** The same person can have different jobs in
  different parts of the organization, and the system never confuses them.
- **A decision that doesn't phone home.** Once issued, a service can check
  "is this allowed?" on its own, without calling back to a central system —
  useful when that system is slow, down, or on the other side of the
  internet.
- **A bounded window, not "eventually revoked."** When access is pulled, the
  already-issued decision expires on a short, known clock rather than lingering
  indefinitely or being promised to update "eventually."
- **Specific places, not a flat admin flag.** Access names a team or a site,
  not "everything" — there is no all-powerful switch to flip by accident.

## What this is not

It does not replace your identity provider (the thing that confirms who
someone is) or connect to a directory like Active Directory or LDAP. It
decides *what someone may do once they're already recognized*, inside an
organization that works in more than one place at once. If your whole
problem is one application with one role per person, this is more machinery
than you need.

One thing to know before, not after, a pilot: the production runtime today
is Cloudflare only. If your infrastructure requirements rule that out, that's
worth surfacing in the same meeting, not the next one.

## Read next

- The root `README.md` — the opening and a runnable example.
- [`../positioning.md`](../positioning.md) § Current limits — the honest list
  of what is not built yet.
- [`README.md`](README.md) — the four audiences and what to show each.
