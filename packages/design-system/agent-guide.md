# Somae Design · agent guide

Version 0.2.0 documents the current working direction: **Wave** is the selected mark, **Signal** is the product interface, and **Electric** is the default material. All three materials use neutral near-black surfaces. Electric, Infrared and After hours keep their acid, coral and lavender accents; the latter two remain experimental. Earlier prototypes are preserved explorations, not the canonical design system.

## Read before implementing

- [tokens.json](./tokens.json) is the canonical token source, using the DTCG 2025.10 format. Read each token's description and status along with its value.
- [tokens.css](./tokens.css) contains generated CSS custom properties. Apply `data-theme="electric"`, `"infrared"`, or `"afterhours"` to the document root.
- [tokens.js](./tokens.js) exports `metadata`, `tokens`, `themes`, and `cssVariables(theme)`. [tokens.d.ts](./tokens.d.ts) describes those exports. Values are CSS-ready; convert units and font stacks explicitly for native platforms.
- [catalog.json](./catalog.json) is a flat, generated index for lookup and tooling. Entries include `path`, `type`, `value`, `cssValue`, `description`, `cssVariable`, `theme`, and `status`.
- [Wave SVG](./assets/wave.svg) is the approved geometry. [Ink](./assets/wave-ink.svg) and [acid](./assets/wave-acid.svg) downloads have explicit fills for image embedding.

## Apply the visual language

Use semantic roles rather than copying palette values. `panel` is neutral near-black (`#0c0c0c`) in every material. `surface` and `surfaceHover` create restrained elevation without blue, red or purple tint. Pair foreground and background roles from the same theme. Check contrast in the actual state and composition; a named token alone does not guarantee accessible contrast, especially over an image.

Reserve `accent` for Wave, one primary decision or send action, and a tiny new-signal indicator. A second button, selected comment, input focus and image region do not all need the same bright treatment. Use `focus` for a visible neutral keyboard ring, `selection` for a selected row, and `annotation` with `annotationFill` for image boundaries and pins. Saved regions stay quiet; only the current region gains local emphasis. An annotation may need a dark keyline to remain visible over light content. `line` is a divider, never the sole focus cue.

Keep the interface compact, with restrained corners, matte surfaces, and a clear primary action. Rich agent content occupies a separate canvas; the sidebar holds one comment list, one optional composer and a stable response area. Match that response area to the source interaction: `ask_question` shows the agent's exact offered choices or a free-text field and Send answer; only `request_review` shows Approve / Request changes. Never show both models together, infer an approval from question wording, or add an approval stamp to a question answer. Optional comments add context to either response without changing its meaning.

Hide provenance, request detail and revision history behind explicit disclosure controls. Show essential scope and required response controls while keeping the full request text expandable. Do not repeat instructions, save assurances, metadata labels and button explanations around every note. The comment composer has no repeated heading or current-asset label: the canvas already supplies that context. Use a small auto-growing field without a native resize grip. Show comments for the current asset, with quiet counts on other asset tabs. Comment dividers span the full width of the sidebar; put horizontal padding on row contents rather than shortening the divider with an outer rail inset. Close the editor on asset/version navigation and preserve its exact draft behind Resume; never retarget it. Offer one explicit whole-image comment control, not a second permanent overall-feedback field. Keep existing review-wide feedback accessible when present.

Give text distinct jobs. Comment bodies use the sans body scale, regular weight and 1.5–1.6 line-height. Compact section headings use semibold. Secondary file/version metadata uses the smaller sans scale and muted color. Monospaced type is for short indexes, keyboard hints and technical values, not whole paragraphs or every label. Keep real paragraph breaks in agent text; avoid tight tracking and all-caps treatment on sentences. Legacy 8–10px specimen tokens are not defaults for new product copy. Sender marks retain their own identity and should not become Somae's accent color.

Use Wave as a single-color silhouette without stretching, outlining, adding fingers, or modifying its path. Inline the `currentColor` SVG when inheriting a text color. An SVG loaded through an `<img>` does not inherit the parent's `color`; use an explicit-fill download there. Label meaningful marks accessibly and hide decorative repetitions from assistive technology.

The source prototype is dense. For touch interfaces, larger hit areas and more generous spacing are **proposed adaptation rules**, not evidence that its compact desktop controls are ready for mobile. Preserve keyboard access, visible focus, meaningful labels, and usable text at increased zoom.

## Motion and interaction

Motion explains a state change: summon, dismiss, resize, reveal, or confirm. Apply state immediately and animate its presentation. Do not delay a response until an animation ends. A newly arrived signal may give the closed beacon one short Wave greeting using `motion.duration.attention`, then settle even if the person never opens it. Trigger this on a new signal identity, not count polling, restoration or theme changes. Keep reading surfaces still; avoid continuous pulsing, waving, or floating decoration. Use the named duration and easing tokens consistently.

Honor `prefers-reduced-motion`: remove spatial movement and use an immediate transition or restrained opacity change. A receipt, focus change, or label must communicate completion even without animation. Dialogs retain focus, suspend background shortcuts, and restore focus when closed.

## Preserve the product model

Somae lets a person **send a message to an agent and receive signals**. The agent owns the work. Do not introduce a Somae task tracker, task lifecycle, or progress dashboard. Counts describe signals waiting for a response, not outgoing messages or work in progress.

Hosted agents may receive new messages from supported devices. A local agent may receive a new message only from Somae on that same machine. Another computer being online does not make its local agent a hosted destination. Keep unavailable destinations understandable and recheck eligibility when sending.

Keep the sender, destination, permission scope, and consequences visible at the point of decision. Sharing saved context is an explicit choice. A draft survives hiding the interface; sending and approval require deliberate actions. Distinguish a sent receipt from an agent's eventual response. Do not imply that pausing a connection stops work already running elsewhere.

## Updating the system

Edit the canonical JSON, rebuild its generated exports, then review the visual guide and affected components. Do not edit generated CSS or JavaScript by hand. Keep experimental changes labeled. This reference describes the chosen direction; not every production or prototype value has been migrated to these tokens.
