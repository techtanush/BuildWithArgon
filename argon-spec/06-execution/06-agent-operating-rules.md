# 06 — Operating Rules for the Coding Agent

These rules are also in [`../templates/AGENTS.md`](../templates/AGENTS.md), which is copied to
`argon-app/AGENTS.md` so any coding agent working in the app reads them first.

1. **Read before you build.** Read `argon-spec/README.md`, all of `00-overview/` and
   `01-architecture/`, then the section for your phase. Re-read the relevant section before each
   file you write.
2. **The spec is the contract.** Use the exact paths, IDs, endpoint shapes, table names and values
   in the spec. If the spec is wrong or impossible, change the code minimally, and record the
   deviation in `docs/DECISIONS.md` (ID, what, why).
3. **VERIFY items are confirmed, not guessed.** Confirm external API shapes with the installed
   Gemini skill / official docs / a live probe; write the confirmed shape in
   `docs/VERIFIED_API_SHAPES.md`; change only the adapter module.
4. **Checkpoints are mandatory.** End every phase with its verify commands green, a BUILD_LOG line
   and a commit. Don't start the next phase on a red checkpoint unless you applied the documented
   fallback.
5. **Never fake.** No hard-coded demo data in product code paths, no mocked responses outside
   `LLM_MODE=fake`, no "verified" badges without the checker. Hide unfinished features.
6. **Never weaken a check to pass it.** Tests, probes, validators and gates are not edited to make
   failing output pass. Fix the output.
7. **Gates are sacred.** Never add a code path that merges, posts publicly, sends, spends past
   budget, registers an agent or connects an integration without `gates.require_approved`.
8. **Secrets stay in `.env`.** Never print, log, commit or send keys to the browser. Run `redact()`
   on everything stored.
9. **Keep the world stateless about the company.** No visual in the world may depend on company
   status. Conversations are the only live content.
10. **Small, verified steps.** Write a module, write its test, run it, then move on. Prefer
    finishing a phase end to end over polishing one part.
11. **Record evidence.** Worldgen runs, eval results and the BUILD_LOG are part of the product.
    Commit them.
12. **Pronouns.** Generated copy about agents or people uses they/them unless a person stated
    otherwise.
13. **Old repo code.** Never import from the old Foundry code (`backend/`, `src/`, `api/`). Adapt
    only the helpers in the TAKE list of
    [`../reference/foundry-existing-repo-notes.md`](../reference/foundry-existing-repo-notes.md),
    with an "Adapted from" comment; never take the DO-NOT-TAKE items.
