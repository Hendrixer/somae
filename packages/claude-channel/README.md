# Claude Code channel

**Stopped · October 25, 2026:** Scott requested stopping recurring cloud usage. The active bridge was terminated, the user-scoped Somae MCP entry removed and the installed bridge executable renamed to a disabled backup so cached clients cannot restart it. The cloud API also rejects data routes before Durable Object/R2 access. Existing Claude sessions and Somae history remain intact. The setup and live proof instructions below are historical/reproduction context; do not reconnect the integration until Scott requests resuming it. See the [API operations guide](../../apps/api/README.md).

Somae connects to Claude Code as a two-way MCP Channel. Claude owns its work and uses the person's existing subscription login; no ACP server or Agent SDK/API-key session is needed.

## Desktop integration

`src/remote.ts` is the application adapter. It polls an endpoint-scoped Cloudflare outbox, persists each input in local SQLite before forwarding it, and offers explicit acknowledgement, reply, question and original-file publication tools. Transport forwarding is not an agent acceptance receipt. If the bridge restarts after forwarding but before acceptance, the outcome becomes unknown and is not blindly injected again. Publication retries reuse stable keys and original SHA-256 byte copies.

Events carry exact conversation/input IDs. Claude acknowledges a real inbound input before replying. For work requested in a terminal, `open_conversation` opens an endpoint-authored, session-bound conversation; subsequent publications use its returned conversation ID without fabricating an inbound receipt. Questions publish required native text/choice interactions. Files must resolve inside the selected project, use a supported document/image extension and fit within 20 MB. Revisions reuse artifact identity and expected revision, with the exact review ID when applicable.

After publishing work that needs approval, call `request_review` with `conversation_id`, a readable `text`, optional `input_id`, and a nonempty `artifacts` list of exact `{artifact_id, revision}` pairs. Somae supplies **Approve** and **Request changes**. The tool accepts no `choices`, action labels or custom buttons; unsupported decision fields are rejected before acknowledgement or publication. Both decisions allow comments or no comments, and send the explicit decision plus all submitted feedback in one event. Comments alone do not mean rejection, and an empty comment list does not mean approval. Use the explicit decision to determine what the person chose. Do not send a second `ask_question` to recreate these review decisions. `ask_question` remains for other clarifying choices or free-text questions.

Both tools return a **publication receipt** immediately. A signal ID is not an answer and no polling tool is needed: the person's later response arrives as a Somae channel event. A structured review response includes the exact request, signal revision, selected approval action and terms digest, artifact versions, review ID and all submitted feedback. A question retains its offered choices or free-text answer, including when the person adds artifact comments; comments do not turn a question into an approval or select an answer for them. Acknowledge that inbound event before acting on it. Content approval does not grant permission to publish externally or execute commands.

Signal publication uses tools that express intent rather than a generic type field. `reply` publishes an optional result; `ask_question` publishes a required question with up to eight numbered `choices`, or a free-text response when choices are omitted; `request_review` publishes the fixed binary approval interaction pinned to the supplied artifact versions. Their `text` can contain Markdown. Start with a short plain first line for the separate display title, then a blank line and the Markdown body. The desktop supports paragraphs, lists, emphasis, code, quotes, tables and explicit HTTP/S links. Raw HTML and embedded images stay inert; publish images with `publish_artifact` instead. For example, a review text can be `Ready for your eye.\n\n- **Links** keep their labels.\n- The \`properties\` stay in the file.` No extra formatting argument is required. Existing text publications use the same renderer without changing stored content or response identity.

The desktop main process owns configuration and bootstrap credentials. Managed sessions use `src/launch.ts`, a genuine interactive CLI in an app-owned PTY. Terminal sessions use the user-scoped MCP configuration and `somae-claude` launcher installed by the desktop. Custom development Channels require per-launch enablement; an arbitrary unconfigured live process must restart/resume. The launcher handles only the known development-channel notice for its own channel. It does not infer permission decisions from model text. Claude's normal tool permissions remain active; the desktop's direct session screen provides local controls for its prompts.

Closing Claude's stdio transport stops the bridge's polling and forwarding. EOF, transport closure and termination signals share one shutdown path, which attempts one offline announcement and an authenticated disconnect callback to clear the desktop's local presence. Shutdown waits at most 1.8 seconds for those requests; an unreachable service cannot keep a closed terminal session running. Existing session identity, conversations and files remain available as history.

The adapter publishes through the shared domain/library boundary. Agent instructions encourage tool-based replies; they are not a deterministic guarantee that every terminal turn becomes a signal. Provider-specific permission mirroring and automatic Stop-hook publication remain future work.

## Original transport spike

`src/server.ts` preserves the standalone localhost proof. Its authenticated bridge, temporary journal and copied bytes live under ignored `artifacts/channel-proof/`. This spike does not apply the production domain/library boundary and should not replace `remote.ts` in the desktop.

## Reproduce the live proof

Install with `bun install` at the repository root. Authenticate your installed Claude Code using its subscription login. Run `node scripts/channel-proof.mjs setup`, then launch the native Claude executable in `artifacts/channel-proof/workspace` with:

```sh
claude --mcp-config /absolute/path/to/somae/artifacts/channel-proof/mcp.json \
  --dangerously-load-development-channels server:somae \
  --allowedTools mcp__somae__acknowledge_input mcp__somae__reply mcp__somae__publish_artifact
```

Accept the local-development channel confirmation. This option enables this locally developed channel; it does not bypass tool permissions. Channel setup is persistent, but enablement remains per launch. Custom research-preview channels do not work in `-p` or Agent SDK execution. An unconfigured existing process must restart/resume with the channel enabled. Resolve the native executable directly if another older global npm installation shadows it.

From a second terminal at the repo root:

```sh
node scripts/channel-proof.mjs send "Acknowledge this input and reply through Somae with a short greeting."
node scripts/channel-proof.mjs status
```

Success requires an actual `input.accepted` event and a `reply` produced by Claude through the MCP tool. MCP client tests alone are not live agent proof. `publish_artifact` copies original document/image bytes with a SHA-256 digest; the application will own artifact identity, exact revisions, feedback and library projection.

## Checks and sources

`bun scripts/managed-channel-proof.ts` separately proves Somae can own a real interactive Claude process in a PTY without opening an external terminal window. It handles only the known pre-input local-development notice for Somae's own channel; it does not scrape model output into permission decisions. The installed Claude `--bg` path started an MCP server but did not deliver channel input in the tested build, so use the verified app-owned PTY path. Evidence is saved in ignored `artifacts/verification/claude-managed-channel.json` after an actual acknowledgement and reply.

Run `node --test packages/claude-channel/*.test.js` for the original spike and `npm run check:desktop` for persistent remote-channel transport/restart and host security/draft checks. Run `npm run verify` for the combined gate. These local checks do not authenticate or call Claude. The separate real-agent proof is saved under ignored verification artifacts after it has actually passed.

- [Channels](https://code.claude.com/docs/en/channels)
- [Channel reference, reply tools and preview restrictions](https://code.claude.com/docs/en/channels-reference)
