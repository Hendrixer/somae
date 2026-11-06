# Signal interaction review

October 11, 2026 · Local prototype

The primary experience is a compact queue of signals. The person reads, responds or marks a result Done, then moves directly to the next signal. An empty queue shows **Nothing else needs you**. Left/Right and visible arrow controls move through every unhandled signal. Merely opening a result does not clear it.

The material, Wave mark, sender logos, large questions, explicit choices, and expandable canvases remain Signal's design direction. The first decision prototype is preserved in `archive/decision-v1`.

## Core and optional information

The main surface includes the sender and agent instance, subject, result or request, relevant original message, the available response/Done action, and decision consequences. Original-message context for a result does not require opening history.

**Details** contains prior messages, shared-context snapshots, earlier artifact references, and retained drafts. It is optional information and never required to clear the active queue. The inbox, search, recent conversations, connections, and context editor are secondary surfaces reached deliberately. No task tracker or execution dashboard is added.

## Response behavior

There is one Reply action. The separate Follow up button was removed because it introduced another concept and slowed the core loop. A successful reply or decision advances automatically. A result can instead be marked Done, which changes only the person's queue state and leaves the conversation and agent interaction record intact.

Clarifying an approval does not grant it. The request remains in the queue while the person can continue through other signals. Required decisions retain explicit labels and pinned consequences. The universal Undo was removed; historical records do not promise to reverse agent effects.

## Changing and delivery states

Updates preserve the draft and require review before submitting against the new revision. Withdrawal, expiry, and answers from another device remove the obsolete request from the queue and advance; saved drafts remain in Details.

A reply to an existing local session can queue while its demo machine is offline. Sending a new message to that endpoint remains restricted to its own machine. Reconnection updates the receipt without taking over the current signal. A failed delivery surfaces a persistent explanation and a recovery action on the main instrument, not solely in history.

The outside **Try** and **Agent reply** controls simulate these cases. They are not part of the product UI and invoke no provider APIs. All four agent models are local fixtures sharing the same human-facing flow.

## Validation

Reviewed the core layout at desktop and narrow widths, including a 320-pixel footer. Tested arrow navigation and forwarding from the interactive iframe, keyboard-only clearing of all four signals, automatic advance after reply, Done without replying, all-clear, and returning from search to the queue. Also checked the composer, context snapshots, connections, preview selection, drafts after updates/withdrawal/another-device answers, queued replies across reload, approval clarification, persistent delivery failure, and the preserved baseline.

Also verified option focus and wrapping with Up/Down and Enter, retained number shortcuts, Command/Ctrl Left to set aside and advance, Command/Ctrl N, forwarding option navigation from the launch preview, and normal text editing and modal behavior. Shortcut hints fit at 320 pixels.

Seventeen model/availability checks pass through `npm run check`. Production delivery, authentication, continuation, synchronization, and custom UI enforcement remain governed by the separate shared contract.
