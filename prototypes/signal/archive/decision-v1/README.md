# Somae Signal

Signal is the third independent desktop exploration. Aura remains at `/`; Gather remains at `/prototypes/gather/index.html`. Their implementations and state are separate.

Run `npm run dev` from the repository root, then open [Signal](http://127.0.0.1:4173/prototypes/signal/index.html#moment/launch).

## The concept

Somae is a place to message an agent and respond to its signals. An incoming signal uses a low, wide instrument: the actual question on the left, the available actions on the right. New opens a focused message composer in the same surface. The agent owns its work and any task tracking. Somae provides the communication surface, context, and permissions, then gets out of the way.

A command index provides access to signals, context, connections, materials, and past responses. There is no task list, task detail page, progress tracker, permanent agent rail, or dashboard home to maintain.

This changes the interaction as well as the skin. A summoned decision comes first; browsing is secondary. Rich content opens deliberately inside the instrument. Hiding it leaves a small beacon that can summon it again. The wallpaper, experiment links, and outside footer are browser presentation chrome, not proposed desktop app UI.

The visual language uses matte ink, an acid accent, large grotesk headings, monospaced indexes, compact controls, and restrained corners. It is closer to an editorial instrument than a softly rounded reading card. Three materials explore the same hierarchy:

| Material | Direction |
| --- | --- |
| Electric | Graphite and acid yellow |
| Infrared | Oxide and heated coral |
| After hours | Deep plum and ultraviolet |

Color identifies the available action. The sender and project remain visible; permission and request context can be disclosed from the sender control. Booking consequences and connection scope stay beside the decision rather than depending on an embedded app.

## Sample interactions

- Claude submits two launch directions. Open the interactive preview, switch directions or preview devices, then choose a direction or request a revision. Choosing a direction does not publish anything.
- ChatGPT asks for approval of one explicit train fare. Approve that fare or ask for another train.
- Daylight asks what deserves time tomorrow. Suggestions populate the reply; the person still sends the answer.
- Orbit requests permission to send one review. The grant excludes context and file access.
- Thoughts add context without completing a decision. Responses produce a receipt with Undo. Set aside removes a signal from the waiting sequence; the command index retrieves it later.
- Context has an explicit Save action. Connection access can be paused; that control does not claim to stop work already running elsewhere.
- **New / Command N** opens a message draft. Write to an agent, choose its destination, optionally include saved context, and send. The context disclosure shows exactly what will be shared. The message and context choice persist through dismissal and reload.
- Sending produces a confirmation. An agent can subsequently send an independent signal. The prototype's optional **Sample signal** control demonstrates this return path; the original message is available in that signal's disclosure.

## Messaging an agent

Try the [message composer](http://127.0.0.1:4173/prototypes/signal/index.html#new). The destination picker distinguishes a connected hosted agent from a local agent instance. Hosted destinations can receive new messages from either preview device. A local destination can receive a new message only from Somae on the same computer: Codex on This Mac is available from the MacBook preview; Codex on Studio is unavailable even though that computer's fixture is online. Neither local instance is available from the iPhone preview. Paused, offline, disconnected, or incoming-only destinations are unavailable for new messages. Eligibility is checked again on submission.

The sent confirmation uses `#sent`. It confirms the local prototype action; it does not show the agent's work status. The signal count measures incoming requests awaiting a response. Sending a message does not increase that count.

**Preview device** and **Sample signal** are controls outside the proposed app. Preview device switches between MacBook and iPhone scenarios; its URL query parameter is a simulation, not proof of device identity. Sample signal is available from the sent confirmation and creates a mock incoming question. It does not advance a task lifecycle. All destinations, messages, and signals are local fixtures; no API or CLI is invoked.

The composer, availability rules, and model checks live in `message-ui.js` / `message-ui.css`, `message-model.js`, and `message-model.test.js`. Earlier task-draft content is migrated into a message draft. Historical `#activity` and `#task` routes return to signals.

The [design review](DESIGN-REVIEW.md) records the findings and the decisions still to make, including response reversal, native message inputs, and production enforcement of execution boundaries.

The launch preview is a sandboxed iframe with scripts enabled. Its allowlisted selection messages update the parent's chosen direction; the trusted response control remains in Somae. These are local examples of the layout relationship, not a completed production security architecture.

Sender icons appear on requests, responses, search results, destinations, connections, and embedded-canvas headers. Claude and ChatGPT use bundled logo assets; Daylight and Orbit use original custom marks. Missing images fall back to an initial. Brand colors stay consistent across the three materials. See [asset sources](assets/SOURCES.md).

## Keyboard

These shortcuts work while this browser prototype has focus. Use Ctrl instead of Command on Windows.

| Key | Action |
| --- | --- |
| Command/Ctrl K | Summon when hidden; switch between the decision and command index when open |
| Command/Ctrl N | Write a new message or resume its saved draft, including from the embedded canvas |
| Up / Down | Move through command results |
| Enter | Open a command result |
| Left / Right | Previous / next waiting signal, outside text editing |
| 1 / 2 | Choose the displayed keyed action |
| P | Open or close the launch canvas |
| N | Add a thought on a decision that supports it |
| Command/Ctrl Enter | Send the active message, reply, or thought form |
| Escape | Leave text editing, close the current layer, step back, or hide the instrument |

Visible controls also work with a pointer. There is no OS-level hotkey, tray integration, native overlay, or automatic incoming notification in this prototype.

## State and motion

The external **Mark** selector compares refined **Wave** (the default) and **Hello** in the header and floating beacon. **App icon** opens the matching icon at 112, 48, and 16 pixels, with SVG download and a link to the [paired refinement sheet](../marks/refined.html). These are design previews. The icon is not installed into the operating system. Earlier logo rounds and original SVGs remain available.

The `mark=wave` or `mark=hello` query parameter takes precedence over the independent `somae-signal-mark` preference. Changing the mark updates only the logo slots, preserving the current view and draft. The icon dialog suspends app shortcuts until it closes.

Responses, added thoughts, selected direction, material, deferred signals, paused access, explicitly saved context, the message draft, the sent confirmation, and sample incoming signals use the independent local-storage key `somae-signal-v1`. Unsent reply and thought drafts live in session memory; a reload discards them. Unsaved context is a separate in-memory draft. Sending a new message includes a copy of the currently saved context only when explicitly selected. Incoming signals are independent communication records; there is no Somae-owned task lifecycle.

The current motion treatment uses a brief shutter reveal, size interpolation, content entrance, and response confirmation. It has no continuously moving decoration around reading content. Actions change application state immediately; animation presents the result. Reduced-motion handling is implemented. Motion timings are choices for this experiment, not specifications attributed to Raycast or Apple.

Every agent, permission, booking, message, and signal shown here is fictional local demo state. Nothing connects to a real agent, books travel, changes a calendar, sends an external message, grants external access, or publishes a website. The Claude and ChatGPT destination labels do not imply an implemented provider API integration. Local browser storage is not a durable request backend. Production authentication, scoped grants, delivery, cancellation, iframe origins, CSP, and capability enforcement remain implementation work.

## Reference direction

This is a forward-looking experiment informed by 2026 references. The research did not find a verified video establishing a specific 2027 design trend. Signal should not be presented as evidence of a settled 2027 industry direction.

Research inspected video metadata and chapters, selected frames, and available captions rather than watching every video in full. The useful directions were sharper visual identity, editorial indexes, purposeful small interactions, and a summoned utility surface. Their combination here is a Somae design proposal.

Sources:

- [Malewicz — UI design is changing](https://www.youtube.com/watch?v=psyw2_j_5jk), June 4, 2026.
- [Sam Crawford — 2026 Web Design Trends You Need to Know](https://www.youtube.com/watch?v=rFyOIWMwRdg), March 1, 2026. The research used the archival-index chapter at 5:19 and microinteractions chapter at 6:07 among its reference points.
- [Saptarshi — 2026 design trends](https://www.youtube.com/watch?v=oS6yrgwSIqc). A visual frame at 5:42 was inspected.
- [Raycast — The New Raycast](https://www.raycast.com/blog/the-new-raycast), May 14, 2026.
- [Raycast — A Technical Deep Dive into the New Raycast](https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast), May 14, 2026.

The temporary research records are `/tmp/somae-youtube-design-research.json`, `/tmp/somae-2027-raycast-research.json`, `/tmp/somae-2027-video-lookup.json`, and `/tmp/somae-raycast-motion-details.json`. They are session working files, not permanent repository assets.

## Validation

The original Signal layout was reviewed in Chromium at 1440×1000, 1100×850, 960×550, and 390×844. That pass addressed page overflow, internal scrolling in small windows, and narrow footer chrome. These are prior validation results, not a completed pass of the revised message flow.

Earlier browser checks covered selection propagation from the embedded app, device preview and sample CTA, revision and question draft recovery, adding a thought without answering, explicit-price approval, checked permission scope, new grants appearing in Connections, undo, set-aside recovery, search via arrows and Tab, no-match behavior, context drafts versus Save, theme changes, shortcut help, iframe Escape/Command K, interrupted dismissal, and reduced motion.

The original review corrected a finder focus mismatch, a stale selection indicator, invisible question-draft state consuming Escape, inaccessible outside navigation, insufficient secondary text contrast, and viewport overflow. Sender-icon checks covered logo loading, search by sender, sender disclosure, matching response receipts, and image-error fallback at desktop and narrow widths.

The deliberate tradeoff: this is less glanceable across many agents than Gather. Its bias is one meaningful decision at a time. The large graphic wallpaper is presentation context; the actual native surface would be the instrument and its small beacon. A production pass should test native window resizing and global shortcuts on real desktops, plus keyboard and screen-reader behavior across the embedded-app boundary.

Brand refinement follow-up: visually reviewed the paired sheet, header, beacon, and icon dialog at desktop and narrow widths. Checked the sheet for overflow from 320 to 720 pixels; checked the fully populated preview toolbar from 320 to 1300 pixels and corrected a beacon collision and tablet label wrapping. Verified all three material colors, mark preference across reload and device changes, preserved composer DOM and text, both marks updating together, and dialog shortcut isolation with Escape focus restoration. JavaScript syntax checks and the nine existing message-availability tests passed.

Message-flow follow-up: checked sending from desktop and iPhone previews, same-computer local delivery, rejection of a local send after switching to iPhone, persistent drafts and optional context, sent confirmation, and independent sample signals with original-message disclosure. Sending does not add a signal or create a work record. Replying only records the response. Verified the removed command, historical task-route redirect, all-clear entry point, Command N from the embedded canvas, and usable internal scrolling at 960×550. Visually reviewed the composer and confirmation at desktop and 390×844, correcting the narrow Send label. A migration check preserves the prior draft and existing signals while removing old work records. `npm run check` passes, including nine message-availability tests; embedded-canvas JavaScript syntax also passes. Aura and Gather were not edited in this revision.
