# docs/

Where written-down thinking lives. Each folder has a different job — pick the right one and the docs stay useful instead of decaying into a graveyard.

## ⚠ Code is the source of truth

These docs may be wrong. Even ADRs. Even the architecture reference. Even this README. Code wins every disagreement — when a doc says one thing and the implementation says another, trust the code and update the doc. Treat docs as intent, not as contract.

## Folders

| Folder | What it's for | Tense | Lifetime |
|---|---|---|---|
| **`reference/`** | The living, always-current description of the system as it stands — architecture, repo structure. The backbone the other folders revolve around; `CLAUDE.md` is its compressed form. | Present ("the system is X") | Permanent; continuously updated, never superseded — ADRs edit it in place |
| **`discovery/`** | Exploratory thinking before committing. Brainstorms, spikes, half-thoughts, "what if we…" | Future / hypothetical | Until promoted or abandoned |
| **`adrs/`** | Architectural Decision Records — one file per committed decision (the *why*) and the recipe / pattern that follows (the *what to do*). An accepted ADR updates `reference/` to match. | Past ("we decided") + imperative | Permanent; superseded by later ADRs that say so explicitly |
| **`plans/`** | Active build plans with status. "Here's what we're doing now and what's done." | Imperative + status | Lifetime of the build; stamped done + left as a build log when finished |
| **`learnings/`** | Things we found out the hard way. Quirks, gotchas, surprises. | Factual ("this is how X works") | Permanent; updated as we learn more |
| **`runbooks/`** | Setup and on-call procedures. "To get X working, do Y." | Imperative procedure | Permanent; updated when procedures change |
| **`design/`** | Fixture documents for looking at typography and Markdown rendering. | Present | Permanent |

## How they relate

```
discovery/  →  adrs/   →  plans/   →  learnings/
 (explore)    (decide)   (build)     (gotchas)
                 │           ↓
                 │       runbooks/  (operate)
                 ▼
            reference/   ← the living architecture; every accepted ADR updates it in place.
                           CLAUDE.md is its always-loaded, compressed form.
```

A typical lifecycle: **discovery** (explore) → **adrs** (commit the decision) → **reference** (update the living doc, and `CLAUDE.md` if an invariant moved) → **plans** (build) → **learnings** (surprises) → **runbooks** (operate). Not every doc needs every step. The near-constant: a committed decision should leave `reference/` and `CLAUDE.md` current.

### When a plan finishes

Don't delete it and don't let it rot. Stamp `Status: done — see the relevant ADR` at the top, distill durable content into the relevant ADR / `reference/` doc, and leave the plan in place as a build log (the "how was this actually built" record is valuable). Sweep finished plans into `plans/archive/` only once the live folder gets noisy enough that done plans obscure active ones.

## Distinguishing the easy-to-confuse pairs

**Reference vs ADR:** Reference describes what *is* — current, living, no status churn, rewritten in place. An ADR records a *decision* that changed it — dated, with rejected alternatives, superseded only by a later ADR. Rule of thumb: a decision yields *one* ADR (permanent record) and *edits* the reference (so the current picture stays true).

**Reference vs CLAUDE.md:** Same content, two altitudes. Reference is the full description; `CLAUDE.md` is the compressed, always-loaded rulebook distilled from it. Invariant changes move both together.

**ADR vs plan:** ADR is reference-grade (long-lived: decision + pattern). Plan is operational (this build, this status).

**Plan vs runbook:** Plan is build-time (constructing X). Runbook is run-time (X is on fire, or X needs setting up).

**Discovery vs ADR:** Discovery is open ("what if?"). ADR is committed ("we will, and here's how"). Promoting means the open questions are resolved.

## Working norms

- **One file per concept.** Don't combine multiple ADRs in one file.
- **Every folder has a `README.md` and a `_TEMPLATE.md`.** README states the job and indexes contents; template is the canonical shape — copy it.
- **Keep the indexes current.** Adding, renaming, or retiring a doc isn't done until its one-line entry in that folder's `README.md` index is fixed in the same change.
- **Date-prefix the dated folders.** New ADRs, plans, discoveries, and learnings are named `YYYY-MM-DD-slug.md` — see `adrs/README.md` for why dates beat sequence numbers. Files from before this system (numbered ADRs, undated plans) keep their names. Reference docs and runbooks are living documents, named by topic instead.
- **Status header on long-lived docs.** "Status: accepted/superseded/draft," "Decided: YYYY-MM-DD." Reference docs carry a "living reference — code wins, kept current" header.
- **Cross-link liberally.** ADR → discovery it came from + reference it updates. Plan → its ADRs. Learning/runbook → the ADR for the why.
- **Keep `reference/` and `CLAUDE.md` current.** A committed decision isn't done until the living architecture reflects it.
- **Write so a stranger can read it.** Six months from now, you're the stranger.
- **Prefer "we decided X because Y" over "X is the way."** Rationale ages better than commands.

## Open questions / suggestions

- The plans folder holds sixteen files from March 2026 onward, most finished. Sweep the finished ones into `plans/archive/` once the active ones are hard to find.
- `RELEASING.md` at the repository root is a runbook by nature. It stays at the root because that is where people look for it; the runbooks index links to it.
