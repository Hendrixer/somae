# Desktop companion prototype

Run `npm run dev` at the repository root and open http://127.0.0.1:4173/#request/runs.

## Current direction

Somae is a compact companion rather than a full-screen dashboard. A single request surface sits beside a small dock for the inbox, individual agents, activity, and the rest of the user's space. Other routes open inside the same widget.

The panel has trusted sender/status chrome, a scrollable message surface, and persistent response controls. Simple requests stay compact. A rich request can widen the same panel rather than launch another workspace. The hotel example uses a sandboxed iframe; a narrowly allowlisted selection message changes the parent's booking summary. Approval remains outside the iframe. Production origins, CSP, provenance, and capabilities still need a real security design.

The top and bottom page controls are prototype presentation chrome; they are outside the proposed desktop widget. Minimize collapses the companion to a small pill. This browser prototype does not integrate with the OS tray or provide global shortcuts.

## Flows

- Numbered choices respond directly and show a selected state with Undo.
- Approval requests keep a concrete summary and price with the approval controls.
- Questions support suggestions and typed replies.
- Reviews support approval, change requests, comments, and draft downloads.
- Comments leave decisions open. Final replies close them; Inbox → Answered retains them.
- Search, keyboard navigation, per-agent shortcuts, inbox tabs, activity, connection invitations, context editing, profile editing, pause/reconnect, and local preferences work.
- J/K move between waiting requests; 1/2 choose; Space focuses the composer; Command/Ctrl Enter sends; Escape goes back, undoes the selected answer, or minimizes the inbox.

Every interaction is local sample state. No booking, agent connection, or message leaves the browser.

## Visual system

Shared semantic tokens are in `../../packages/design-tokens/tokens.css`. Aura is the default: warm graphite, softly violet reading surfaces, tactile capsules, precise rim highlights, and a translucent floating dock. Pearl explores rose and Sage explores green. The system font stack uses San Francisco on Apple platforms and native fallbacks elsewhere. No external fonts, framework, installation, or build are required.

The request context is one quiet line. A draft and its download action share one surface. Shortcut guidance lives in Help; the reply action gains emphasis when there is text. UI action icons use one rounded stroke family, while agent marks retain their own identity.

The web materials approximate the direction of native Apple controls; they do not reproduce native optical refraction. Glass is confined to the dock and preview controls. Content stays softly opaque and legible. Higher-contrast and reduced-transparency preferences simplify the materials.

## Motion

`motion.js` separates presentation from application state. Actions take effect synchronously. Animations cancel when interrupted; no transition blocks input or delays a response.

| Interaction | Motion |
| --- | --- |
| Press / release | 110 / 180 ms, subtle compression |
| Request navigation | 340 ms, directional 10 px entrance and dissolve |
| Panel expansion or height change | 420 ms, damped width and height interpolation |
| Answer confirmation | 380 ms receipt entrance with checkmark draw |
| Minimize / wake | 380 / 440 ms, transition between the panel and pill |

These values are Somae design choices. They are not Apple-specified timings. There is no continuous decorative motion around text. `prefers-reduced-motion` skips spatial animation and cancels active effects immediately when the preference changes.

Typed drafts survive navigation and resizing. A final decision includes any typed note. Undo restores keyboard focus to the request. The embedded hotel app stays mounted across comments, decisions, and expansion.

## Reference direction — October 2026

Apple's current design direction gives controls dimensionality while keeping content in focus. The June 2026 platform presentation describes clearer edges, brighter highlights, and more defined icons. Apple’s OS 27 updates started rolling out September 14, 2026. Calendar-2027 styling is our interpretation of these shipped patterns, not a confirmed industry forecast. [WWDC26](https://developer.apple.com/videos/play/wwdc2026/102/), [September release](https://www.apple.com/newsroom/2026/09/major-updates-for-apples-software-platforms-are-now-available/)

Apple's material guidance places glass in the functional control layer and discourages putting it in the content layer. Its motion guidance emphasizes communicating relationships and respecting accessibility preferences. [Materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Motion](https://developer.apple.com/design/human-interface-guidelines/motion), [Reduced motion](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria)

Mobbin references inspected for this pass:

- [Apple Music album library](https://mobbin.com/screens/da6eeb5a-6515-405b-8472-7d6ab55afde0): light content canvas, isolated round controls, compact floating player.
- [Apple Music player](https://mobbin.com/screens/d89d38cd-f756-41e2-9558-9234a1b64dca): content-led color and quiet action hierarchy.
- [Apple Maps place sheet](https://mobbin.com/screens/ef3b62fd-3ae4-4c66-9b0f-690df1554b30): rounded reading sheet with compact control groups.
- [Apple Store](https://mobbin.com/sites/sections/abb0cd17-6c0c-4581-baef-666b69327b1d): clear typography, generous space, distinct content cards.

Earlier directions are preserved in `archive/dashboard`, `archive/companion-v2`, and `archive/studio-v3`.
