# Somae Signal

Signal is Somae's compact desktop prototype: a queue of signals from your agents, with a clear response or Done action, previews that open deliberately, and a small beacon when hidden. Its matte material, Wave mark, typography, and instrument shape remain the current design direction.

Run `npm run dev` from the repository root and open [Signal](http://127.0.0.1:4173/prototypes/signal/index.html#moment/launch). The [earlier decision prototype](http://127.0.0.1:4173/prototypes/signal/archive/decision-v1/index.html#moment/launch) is preserved. Aura, Gather, and all logo studies remain available.

## The core flow

Signals arrive in one queue. Use the footer arrows or Left/Right to move through it. Replying or choosing a decision advances to the next signal; when the queue is empty, Somae says **Nothing else needs you**. A result also offers **Done** when you have read it and have nothing to add. Reading alone does not remove a result from the queue.

**Reply** is the way to continue with an agent. There is no separate Follow up button. A result's relevant original request appears on the main surface with the sender, subject, content, and preview control. Questions and approvals keep their required choices and consequences on the main surface. A clarifying question about an approval does not grant approval; the approval remains in the queue while other signals can be handled.

**Details** opens the conversation's extra context, prior messages, artifact references, and saved drafts. The core queue flow works without opening it. No work tracker, task list, progress dashboard, or agent execution lifecycle is maintained by Somae.

Command K opens the secondary inbox/search or summons the active queue when hidden. Browse **Needs you**, **Results**, and recent conversations there; commands and settings sit in the same searchable surface. New / Command N opens a message composer. Sending a new message returns to the queue or the all-clear state. The agent can later publish a new result in the same conversation.

All communication remains fictional local demo data. Nothing contacts an agent, changes files outside the prototype, books travel, changes a calendar, authorizes a real account, or deploys a project. Interface examples are not provider API integrations or a production implementation of the shared contract.

## Four agent fixtures

| Agent | Fixture | What to try |
| --- | --- | --- |
| Claude · Hosted | Hosted coding agent | Choose a launch direction, give feedback, or preview a staging approval. Open the interactive direction canvas. |
| Codex · MacBook | Local coding agent | Read an inbox-change result and reply from either preview device to its existing session. Queue a reply while the demo MacBook is offline. New messages remain MacBook-only. |
| Orbit · Hosted | Custom turn based agent | Read its Kyoto field notes, reply, and simulate the next result. Each result stays associated with the same conversation. |
| Daylight · Hosted | Custom durable agent | Respond to an event-driven question, or simulate its request being updated, withdrawn, or expired. |

The external **Agent reply** button simulates a reply to the most recent outgoing input, even after the queue advanced. It is a prototype control, not part of Somae's product interface. New results reenter the queue; the same reply is not generated twice without another outgoing input.

## State previews

The external **Try** selector provides updates, withdrawal, expiry, another-device answers, a local offline/reconnected bridge, delivery failure, a staging approval, a connection preview, and replay.

An update preserves a text draft and disables submission until the person reviews the changed request. Withdrawal, expiry, and another-device answers remove the completed request from the active queue and advance; unsent text remains in Details. A queued local response remains saved across reloads. Reconnection updates its receipt without pulling the person away from the current signal. Delivery failure surfaces a persistent explanation and recovery action on the main instrument.

The sample staging approval identifies the environment and operation explicitly. Asking a question leaves it pending. Its later answer can link directly back to the outstanding approval.

**On** changes the simulated calling device, not the viewport or authenticated device identity. The URL `device=iphone` or `device=macbook` preserves the selected preview across reload. The runtime checks new-message eligibility again at send time. A local endpoint being online does not authorize new messages from another machine or mobile. Replies are separately bound to an existing local signal/session in the mock.

## Identity, connections, and context

The secondary **Your agents & handle** view shows the demo handle `@scott`, a copy control, and individual agent instances with location, capabilities, pause, and disconnect. **Connect an agent** previews an explicit connection to North; it performs no real authorization. Disconnect preserves history and withdraws active requests. Pause blocks new input and removes that endpoint from the active queue.

Context remains optional and unchecked by default on a new message. The composer discloses exactly what will be included. A sent message stores a snapshot: editing saved context later does not change earlier disclosures. No handle lookup or connection grants unrestricted access to context.

## Keyboard

| Shortcut | Action |
| --- | --- |
| Command/Ctrl K | Summon the queue when hidden; open inbox/search; return to the last signal |
| Command/Ctrl N | New message or resume its draft |
| Left / Right | Previous / next signal outside text editing |
| Command/Ctrl Left | Set aside the current signal and advance; return a set-aside signal to the queue |
| Up / Down, Enter | First option is focused on arrival; move through choices and activate one |
| 1 / 2 | Choose a displayed decision; Done / Reply on a result |
| R | Reply, give feedback, or ask about an approval |
| P | Open or close the artifact preview |
| H | Open or close optional Details |
| Command/Ctrl Enter | Send the current message or reply |
| Escape | Leave editing, close a layer, or hide the instrument |
| Up / Down, Enter in search | Move through and open search results |

The trusted launch iframe forwards Somae navigation shortcuts when not editing text. Modal dialogs suspend background app shortcuts. Reduced motion removes spatial animation. Shortcuts are browser-local; no OS hotkey or tray integration exists yet.

## Persistence and source

The current prototype uses `somae-signal-v2`, preserving conversations, message drafts, reply drafts, receipts, context snapshots, connections, signal revisions, and user clear/set-aside state. On its first load, it copies the previous material, context, and supported unsent message draft from `somae-signal-v1`. The old storage and archived prototype are preserved. Replay resets only the current demo records while retaining the selected material and saved context.

`conversation-model.js` owns the local fixture transitions and eligibility rules. `app.js` renders the queue, optional details, composer, connections, and preview controls. `conversation-ui.css` extends the existing Signal styles. `message-model.js` retains the original new-message device constraints. `message-ui.js` is retained with the preserved first communication experiment; it is no longer imported by the current app.

**Design** in the outside toolbar contains the Hello/Wave comparison and app-icon preview. Wave remains the default. Its independent preference and URL query remain separate from conversation state.

The [shared communication contract](../../docs/architecture/communication-contract.md) defines the intended production semantics. Backend authentication, durable delivery, provider continuation, real multi-device synchronization, webhook receipts, artifact origins, and custom-UI authorization remain implementation work.

## Validation

The queue was checked end to end with keyboard navigation: decision → result Done → result reply → question response → all-clear. Desktop and mobile reviews covered the compact inbox, native decisions, result previews, reply dock, optional history, queued replies, updates with saved drafts, connection controls, and failure recovery. The mobile send dock remains visible above the sticky footer. Changing conversations resets their scroll position.

Meaningful model checks cover new messages not creating pending decisions, unread versus required signals, local initiation restrictions and bounded remote replies, persisted queued delivery, stale revisions, terminal-state races, clarification not approving, conversation continuity, context snapshots, permissions, and user clearing results without ending the agent's conversation. `npm run check` runs these alongside the preserved message-availability checks.

Prior visual direction and research are recorded in the [preserved Signal notes](archive/decision-v1/README.md). The separate [Somae Design reference](https://somae-design.fine-gull-3581.chatgpt.site) contains the working tokens and Wave assets.
