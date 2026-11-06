# Working in Somae

This guide is for coding agents developing Somae. Somae is a personal interface for communicating with agents; connected agents own their work. Somae has no task tracker.

## Find the relevant context

Start with `README.md` and [our working agreement](docs/WORKFLOW.md). For the area you are changing, run:

```sh
npm run context -- signal
npm run context -- domain
npm run context -- design
npm run context -- prototypes/signal/app.js
```

Read the returned guides before editing. The command reads the existing repository map and business ontology; it does not create another knowledge store. For machine-readable JSON without npm's log header, use `npm run --silent context -- signal --json`. With no arguments it returns the starting guides.

Signal is the current UI direction. Preserve Aura, Gather, logo studies, and earlier Signal. The Electrobun desktop and Cloudflare API are under active construction; mobile is deferred. Prototypes still use fictional browser state. Read `docs/architecture/test-version.md` for the current end-to-end build and its acceptance checks.

## Complete the change

1. Work from the user's desired outcome. Use reasonable implementation choices; ask when a missing product decision would change the result. No issue or elaborate prompt is required.
2. Use existing code and checks. Add or extend ordinary tests when behavior needs coverage; don't create agent benchmarks or duplicate existing assertions. UI changes also need browser review at desktop and narrow widths, including relevant keyboard/focus/draft/advance behavior.
3. Keep context current in the same change. Update the affected guide when usage or behavior changes; update the map when paths/modules/check commands change. For business policy, update the contract, ontology, runtime, types and relevant tests together. A code regression must not silently rewrite the intended requirement.
4. Run `npm run verify` against the final files. It checks source, context references, import boundaries, domain rules/tests and token exports. Reports live in `artifacts/verification/`. Source-change suggestions help locate context to review; they are reminders, not proof that prose is correct.
5. Report the result, checks actually run and material limits. A failing or skipped required check is not completion. The user should be able to inspect the files or working preview.

## Preserve these boundaries

- For business changes, read `docs/architecture/communication-contract.md`, `packages/domain/README.md` and `packages/domain/ontology.json`. Reuse the shared command boundary. Trusted principals stay separate from payloads; raw runtime results/snapshots are host-only and require authorized client projections. Preserve exact revisions, local-machine/continuation policy, immutable evidence and atomic response/message/outbox transitions.
- Reading, clearing or setting aside a signal changes the person's view, not the agent's work or signal lifecycle.
- For visual tokens, read `packages/design-system/agent-guide.md`. Edit canonical `tokens.json`, then rebuild; don't edit generated `dist` files.
- Extend verification and CI when adding a compiler, native app, dependency, persistence or provider adapter. Current checks cover the reference JavaScript code, not every future system.
- Keep credentials out of docs, fixtures and reports. Don't publish the design site, deploy services, initialize/reset repositories or overwrite preserved prototypes as a routine check.
- Reuse an existing preview server or choose another port. Reload after source edits; hash navigation can retain old modules.

The domain runtime uses memory. Its tests do not establish production authentication, persistence, provider delivery or multi-process atomicity. Agent-maintained context and ordinary checks are the system; no separate agent eval program is required.
