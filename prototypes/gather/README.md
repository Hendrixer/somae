# Gather — exploration 02

Open [Gather](http://127.0.0.1:4173/prototypes/gather/index.html#needs) after `npm run dev` from the repository root. [Aura](http://127.0.0.1:4173/) stays at its original URL and its implementation and shared tokens are preserved.

## The idea

Somae is a place for the moments that require a human. Gather starts with those moments, rather than agent sessions. A small queue opens into a focused decision; a horizontal tray keeps the three destinations close: Needs you, In motion, and You. Tucking it away leaves a small pill with the attention count.

The design combines three ideas:

- **An attention tray:** glance at what needs you, then put it away. No permanent sidebar or overview metrics.
- **A focused decision sheet:** the question, source, relevant content, and response have distinct places. Notes stay optional except when the request itself asks for a reply.
- **A canvas that opens on purpose:** compare stays inside a sandboxed embedded surface. The trusted parent keeps the selected stay, total, and approval controls visible while the canvas scrolls. Responding locks selection; Undo reopens it.

The mint, iris, and sand palettes have their own tokens. Soft off-white surfaces carry the content, with restrained glass on the navigation tray. Typography, spacing, and disclosure do most of the work.

## What to try

1. Open the Austin stay, compare three stays, change the selection, add a note, and approve. Try Undo.
2. Review the first hello. Suggest a change, leave the moment, then return to the recovered revision draft.
3. Reply to the weekend question with a suggestion or your own words. Move any moment to Later.
4. Answer the table decision with `1` or `2`. The receipt stays until you choose Next moment.
5. Visit In motion, then You for context, scoped connections, and palette preferences.
6. Tuck the tray away and reopen it with `⌘J` / `Ctrl+J` inside the page.

## Motion

Dimensions settle as the sheet changes size. Route content moves a few pixels in the direction of travel. Replies get a small confirmation, and controls give brief press feedback. State changes synchronously; motion can be interrupted and never controls the answer. Reduced motion removes these effects. Reduced transparency and higher contrast have CSS treatments.

## Critique and iteration

The first pass repeated the calm promise in too many places. The queue now leads with its title, count, and useful action hints. At narrow widths the hints move beneath the source instead of disappearing.

The expanded comparison initially repeated the compact stay summary and pushed the cards below the fold. It now removes that repetition and reserves the available reading space for the comparison. The parent response area remains visible.

Interaction review caught accumulated listeners on persistent controls, revision drafts returning as ordinary notes, settings changes dropping focus, and the preview remaining editable after a reply. These were corrected. Draft intent and text survive route changes, return navigation restores useful focus, and approval facts remain consistent with the embedded selection.

Short windows scroll the full sheet when an expanded composer would crowd out the request. Opening a note brings its response controls into view. The embedded comparison synchronizes its current lock and palette again on load, so a reply during loading cannot leave its presentation out of sync.

The tradeoff: a human queue hides some session detail until In motion is opened. Larger app-like requests may need a dedicated window beyond the 800px comparison sheet. The current prototype demonstrates one contained canvas, not a general app runtime.

## Scope

This is a local HTML/CSS/JS prototype. Requests, prices, agents, and activity are sample data. Responses do not book, publish, contact agents, or change remote permissions. Pausing a connection represents access control, not cancellation of an existing execution.

Sample decisions and preferences use `somae-gather-v1` in browser local storage. Unsaved reply and context drafts last for the current page session; saved context survives reloads. Replay resets the sample moments while keeping saved context and palette.

The iframe uses `sandbox="allow-scripts"`. Its message handler checks the sending window and accepts only the known sample selection and theme values. Production rich apps will need a defined capability protocol and isolation model.

## Verification

Browser review covered 1440×1000, 390×844, and 960×550 windows. Checked comparison selection and receipt consistency, Undo, Later, revision and note draft recovery, keyboard replies and choices, return focus, context saving, connection permissions, palettes, collapsed focus/inertness, and reduced motion. The narrow comparison keeps the parent response visible while its content scrolls.

`npm run check` validates both prototypes' JavaScript syntax; the canvas inline script was checked separately. The six original Aura implementation/token files match their preservation hashes.
