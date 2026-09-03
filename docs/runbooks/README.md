# Runbooks

Setup and when-it's-on-fire references. Procedure-only, no rationale. The "why" lives in ADRs; runbooks just tell you what to do next.

For the role of this folder in the docs taxonomy, see [`docs/README.md`](../README.md). Copy [`_TEMPLATE.md`](./_TEMPLATE.md) to start a new runbook.

## Index

- [`cloud-auth-setup.md`](./cloud-auth-setup.md) — configuring Supabase Auth, the Apple association file, the redirect URLs, and hosting the site and browser client on Vercel.
- [`../../RELEASING.md`](../../RELEASING.md) — cutting a Mac release: tagging, the updater manifest, and the landing page's download link. Lives at the repository root because that is where people look for it.

## Conventions

- **Procedures only.** A runbook is for the operator at 2 a.m. — short imperative steps, every command pastable.
- **Cross-link to the ADR for the why.** Open with a one-line link to the architecture doc that explains the system it operates on.
- **Pair every UI-shaped query with a CLI sibling.** Anyone scripting or driving the runbook from an agent needs the command-line form, not the console filter syntax.
- **Update when procedures change.** A runbook claiming a procedure works when it doesn't is worse than no runbook.
