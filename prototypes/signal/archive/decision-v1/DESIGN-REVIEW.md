# Signal design review

October 10, 2026 · Local prototype

Somae lets a person send a message to an agent and respond when that agent sends a signal. **The agent owns the work and its tracking.** Somae owns the communication surface, identity, context, and permissions.

Keep Signal's matte material, strong typography, sender identity, deliberate canvas expansion, and ability to disappear. The new-message composer fits that same compact surface. A sent confirmation closes the loop; an agent's later signal arrives as an independent request.

## The interaction model

- **New and reply are distinct.** New / Command N opens `#new`; incoming signals retain their own response controls. The header count is plain status text for signals awaiting the person.
- **The destination is explicit.** A message has text and a selected agent endpoint. Saved context is optional and unchecked by default, with a disclosure showing what will be shared.
- **Availability appears at selection time.** Available destinations come first; unavailable destinations remain discoverable with an explanation. Permission to receive an agent's signals does not automatically permit sending it new messages.
- **Drafts survive interruption.** Message text, destination, and context choice persist across dismissal and reload. The earlier composer draft is migrated rather than discarded.
- **Sent means the message step is complete.** `#sent` is a confirmation, not a work-status screen. Somae does not maintain task lists, task details, progress, completion states, or an activity command.
- **Signals stand on their own.** The optional Sample signal control creates a mock incoming question with the original message in its disclosure. Answering that question records a response; it does not update a Somae task lifecycle.
- **Quiet is a useful state.** When nothing needs an answer, the person can write a new message or dismiss Somae. Sending alone does not add to the signal count.

## Where a new message can go

The destination is an **agent instance**, not just a brand. A familiar logo helps recognition; that instance's location, capabilities, and grants determine whether it can receive a new message.

| Destination | New-message rule |
| --- | --- |
| Connected hosted agent that accepts new messages | Available from supported desktop or mobile clients when its service is available |
| Local agent on the current computer | Available from Somae on that same computer when its runner is available |
| Local agent on another computer | Unavailable from this device, even when that computer is online |
| Incoming-only agent | Receiving its signals does not grant permission to send it new messages |

Submission rechecks eligibility. There is no remote queue, wake-computer action, or tunnel that turns another computer's local agent into a hosted destination. Replying to an existing signal remains a separate policy from sending a new message.

## Prototype boundaries

Preview device and Sample signal sit outside the proposed app UI. The MacBook / iPhone URL query is a simulation, not trusted device identity. Sample signal is available from the sent confirmation and demonstrates an agent sending a question back. It does not simulate work progress.

The implementation uses `message-ui.js` / `message-ui.css`, `message-model.js`, and `message-model.test.js`. Historical `#activity` and `#task` routes return to signals. Claude and ChatGPT are hosted-agent fixtures, not implemented provider API integrations. No agent is contacted, no work executes, and no background delivery occurs.

## Remaining decisions

- **Response reversal:** the existing Undo remains for prototype exploration. A real agent may act immediately after a reply. Production should support follow-ups or amendments and offer cancellation only when the receiving agent can honor it.
- **Message inputs:** attachments, native screen capture, and choosing a local project need deliberate flows. The fixed workspace is a fixture.
- **Delivery:** live availability, authentication, scoped permissions, delivery failures, duplicate prevention/idempotency, and durable communication need backend enforcement. The agent remains responsible for tracking its work.
- **Existing replies across devices:** decide how a reply to an existing request is stored and delivered without quietly broadening the new-message initiation boundary.

The revised flow has passed browser checks for sending, incoming signals, replying, device restrictions, draft persistence, keyboard navigation, and narrow layouts. Nine eligibility tests and a migration check also pass. See the [README validation record](README.md#validation) for coverage and limits.
