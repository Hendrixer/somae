# Somae

A personal interface for communicating with agents: messages, signals, responses, permission, context, and delivery. Agents own their execution; Somae does not track their tasks.

This repository is a monorepo with shared protocol rules and design tokens. Browser prototypes established the compact companion direction. The first real desktop test connects Claude Code to the native app and Cloudflare service; see the [execution brief and live checks](docs/architecture/test-version.md). Mobile is deferred for this test.

## Layout

- `apps/api` — private Cloudflare Worker at `api.getsomae.ai`, SQLite-backed Durable Object and R2 originals; verified with real channel, file, review and revision round trips.
- `apps/desktop` — Electrobun/Bun native shell; builds/runs on macOS, with the Signal queue, review canvas and persistent library.
- `apps/mobile` — future mobile app; React Native is the current direction.
- `apps/website` — the public site at `getsomae.ai`, a static-assets Cloudflare Worker with animated product demos; see its [guide](apps/website/README.md).
- `packages/design-tokens` — semantic CSS tokens and three quiet light palettes (Aura, Pearl, Sage).
- `packages/design-system` — Somae Design v0.2: canonical Signal tokens, approved Wave assets, generated CSS/JavaScript, and a shareable visual reference. Earlier palettes remain in their original packages.
- `packages/domain` — executable communication rules, a machine-readable ontology, four integration fixtures, and conformance tests. This is a shared reference runtime; production storage and provider adapters are still to come.
- `packages/library` — version-bound reviews, approval pins, drafts and safe client projections on the shared command boundary.
- `packages/claude-channel` — a live two-way Claude Code channel proof, replies and original file publication.
- `prototypes/desktop` — preserved Aura companion exploration, in plain HTML, CSS, and JS.
- `prototypes/gather` — a separate exploration around a personal attention tray and focused decisions; owns its tokens and sample state.
- `prototypes/signal` — an experimental summoned decision bar, with matte materials, a keyboard command index, and an expandable interactive canvas.

The cloud API is currently paused at Scott’s request to stop recurring Durable Object usage; see the [operational status](apps/api/README.md). Desktop and API remain under construction; mobile remains reserved. The domain package stays independent of UI and transport. Preserved prototypes retain their own fictional demo models and remain separate from the real app.

## Run the prototype

For the real desktop build, first run `bun install`, then `npm run desktop`. `npm run check:api`, `npm run check:desktop` and `npm run check:website` check the applications; `npm run verify` runs the combined gate. See the desktop guide for private test setup and the execution brief for live verification status. The commands below run the preserved browser prototypes.

```sh
npm run dev
# or: bun run dev
```

Open http://127.0.0.1:4173. No installation or build step is needed. The preview server requires Node 18 or newer. Set `PORT` to change the port.

Three independent prototypes are available:

- [Aura](http://127.0.0.1:4173/) — the preserved compact companion with an agent dock.
- [Gather](http://127.0.0.1:4173/prototypes/gather/index.html#needs) — a human queue, a bottom tray, and one focused moment. See its [design notes](prototypes/gather/README.md).

- [Signal](http://127.0.0.1:4173/prototypes/signal/index.html#moment/launch) — a direct decision, a command index, and a small beacon. See its [design notes and research](prototypes/signal/README.md).

All content is fictional sample data. Replies, connection decisions, context edits, and preferences stay in this browser's local storage. No agents are contacted or reservations made. To replay, use Your space → Appearance → Reset in Aura, or You → Make it yours → Sample moments in Gather, or search “Replay” in Signal’s command index. Each prototype has separate sample state.

## Shared design reference

[Somae Design](https://somae-design.fine-gull-3581.chatgpt.site) is the last published reference for Signal and Wave. The current v0.2 neutral-black materials, restrained accent roles and review guidance live locally in `packages/design-system`; publishing is a separate action. Agents can fetch [tokens.json](https://somae-design.fine-gull-3581.chatgpt.site/tokens.json) and the [usage guide](https://somae-design.fine-gull-3581.chatgpt.site/agent-guide.md) without signing in. Source and build instructions live in `packages/design-system`; its hosting manifest retains the Site identity for future updates.

## Communication contract

The proposed [Somae communication contract](docs/architecture/communication-contract.md) defines connections, conversations, messages, signals, responses, artifacts, delivery, and context. It walks through local and hosted coding agents plus custom turn based and durable agents, with capability boundaries and recovery scenarios to review before implementation.

## Agent workflow and verification

We work from direct prompts. The coding agent handles finding context, implementation, checks and updating the relevant docs with the code. [Our working agreement](docs/WORKFLOW.md) describes the loop and when a durable issue is useful. No issue tracker or coding-agent eval program is needed to start.

The two everyday commands are:

```sh
npm run context -- signal
npm run verify
```

Use `domain`, `design`, an app name or a file path instead of `signal` to find the relevant guides, source locations and check commands. For pure JSON, use `npm run --silent context -- signal --json`. The command reads the existing [repository map](docs/architecture/repository-map.json) and [business ontology](packages/domain/ontology.json); it does not create another knowledge store. [AGENTS.md](AGENTS.md) tells coding agents how to use these files.

Verification checks syntax, local prototype links, context references/check commands, import boundaries, ordinary behavioral tests and design-token exports. It records results and exact source hashes in `artifacts/verification/latest.json`, with a code graph in `artifacts/verification/repository-graph.json`. Changed files suggest guides to review against the previous saved report. These reminders do not prove that prose is correct; the agent updates affected context in the same change and preserves intended requirements when code disagrees.

Use existing tests first. Add or extend a meaningful test for uncovered behavior; there is no separate benchmark running coding agents through evaluation tasks. `npm run check` is an alias for verification. Focused commands remain available: `npm run check:domain`, `npm run check:design` and `npm run map`.

For business changes, the [domain guide](packages/domain/README.md) links the contract, guarded runtime, types and tests. Future applications should reuse that command boundary. Its fixtures are test data, and its memory implementation does not establish production authentication, durable storage, cross-process serialization or provider delivery.

Validate layout and interaction in a browser as well; the gate does not establish visual quality. A GitHub Actions workflow runs this gate and retains the report when the repo is pushed to GitHub; no remote CI run is implied by a local pass.
