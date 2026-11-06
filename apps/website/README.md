# Somae website

The public site at [getsomae.ai](https://getsomae.ai). It is a static-assets Cloudflare Worker (`somae-website`): no Worker script runs, so requests are served from the edge without invocation limits. `www.getsomae.ai` serves the same files and the page's canonical link points at the apex.

The page is the "Beacon · high fidelity" direction from the Somae website canvas, ported to plain HTML. That canvas is a design reference, not a build input: edit `public/` directly from now on.

## Files

- `public/index.html` — the page. Styles are inline, as in the artboard. The two animated demos (`<figure data-dc="hero">` and `<figure data-dc="review">`) keep the artboard's template syntax: `{{path}}` holes, `<sc-if value>`, `<sc-for list as>` and `data-on-click`.
- `public/assets/site.js` — binds those two figures once and re-renders only changed values every 100 ms. It also holds the scene clocks (`heroView`, `reviewView`, `tick`). A demo only advances while it is on screen and the tab is visible. Reduced motion starts both demos paused on a still scene. Each demo stage sits in a `data-fit` frame: below that design width (960 px hero, 1100 px review) the stage keeps its desktop layout and scales down like a screenshot instead of reflowing.
- `public/assets/desktop.jpg` — hero wallpaper, John Towner on Unsplash (Unsplash License, credited in the footer).
- `public/og.png`, `public/apple-touch-icon.png`, `public/favicon.svg` — share card and icons.
- `public/_headers` — CSP and security headers. The CSP allows only same-origin scripts and images; adding a third-party script, font or image means updating it.
- `public/404.html` — served for unknown paths (`not_found_handling: "404-page"`).
- `test/site.test.js` — checks local references, placeholders, that every demo hole resolves in every scene, the approval sequence, stage scaling and reduced motion.

## Content rules

- Copy follows the positioning: an inbox for everything your agents make, with tools to review any kind of artifact and send feedback back to the agent.
- The site shows review of video, 3D, sites, audio and UI, and lists MCP coding agents as compatible. Today the app reviews documents and images, and only Claude Code is wired. Keep those claims framed as what Somae is for; don't add version numbers, availability dates or download links that imply otherwise.
- Agent marks come from LobeHub Icons (MIT) and keep the footer notice about ownership and endorsement.
- Dark-first and neutral: the accent is white on near-black. Keep color inside product content (wallpaper, film, 3D), not page fields.

## Run and deploy

```sh
bun run --cwd apps/website dev      # http://127.0.0.1:4790 through wrangler dev
bun run --cwd apps/website build    # dry-run deploy; part of npm run verify
bun run --cwd apps/website deploy   # publishes getsomae.ai — only when Scott asks
```

Review UI changes in a browser at desktop and phone widths, including the demo Pause and step buttons by keyboard.
