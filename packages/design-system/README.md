# Somae Design v0.2

A shareable visual guide and machine-readable token package for Somae's current design direction. Wave is selected. Signal is the interface direction; Electric is its default material. All materials use neutral near-black surfaces with restrained accents; Infrared and After hours are experimental.

## Use

After building, open [the visual guide](./dist/index.html), read [the agent guide](./agent-guide.md), or inspect [tokens.json](./tokens.json). The published [agent index](./dist/llms.txt) lists the public endpoints.

The canonical JSON uses the DTCG 2025.10 format. Generated CSS provides semantic custom properties under `:root` and `[data-theme]`. JavaScript exports CSS-ready values and theme helpers, with TypeScript declarations alongside. Native consumers must adapt CSS units and font stacks to their platform.

## Build and validate

From this package directory:

```sh
node build.mjs
node validate.mjs
```

Build regenerates the guide and public token exports in `dist/` from the canonical JSON, static source, assets, and public documentation. Validation checks the token source, neutral surface policy, text/focus contrast, restrained annotation fill and exact generated output. Serve or publish the contents of `dist/` together from one directory. This README describes repository maintenance and is not included in the public build.

## Update

1. Edit the canonical tokens and their descriptions or status.
2. Run the build and validation commands.
3. Review the visual guide, component states, all themes, and reduced motion.
4. Publish the updated static directory to the same host only when requested, so shared endpoint URLs remain stable. The local build does not publish it.

Keep the canonical JSON, build scripts, static source, assets, and documentation in version control. `dist/` is ignored and rebuilt from those files. Do not edit generated exports directly. Keep the approved Wave geometry intact; its explicit-color variants differ only in fill.

## Boundaries

This package describes a working direction, not a complete production component library. Not all values in the prototypes or future native apps have been migrated. Earlier Aura, Gather, and logo studies remain preserved explorations. The guide does not install an operating-system icon or synchronize Figma. Public files contain design data and fictional interface examples only.
