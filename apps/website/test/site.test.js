import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';
import { HERO_DURATIONS, REVIEW_DURATIONS, fitScale, heroView, holes, initialState, lookup, reviewView, tick } from '../public/assets/site.js';

const publicDir = new URL('../public/', import.meta.url);
const html = await readFile(new URL('index.html', publicDir), 'utf8');
const figures = [...html.matchAll(/<figure data-dc="(hero|review)"[\s\S]*?<\/figure>/g)];

test('local references resolve and no placeholders remain', async () => {
  for (const [, raw] of html.matchAll(/\b(?:src|href)="(\/[^"#?]*)"/g)) {
    assert.ok((await stat(new URL(`.${raw}`, publicDir))).isFile(), `missing ${raw}`);
  }
  assert.doesNotMatch(html, /\[(?:ORG|LICENSE|SELF[^\]]*)\]|\/_blob\//);
  assert.match(html, /href="https:\/\/github\.com\/Hendrixer\/somae"/);
});

test('search and share metadata is complete', async () => {
  const meta = name => html.match(new RegExp(`<meta (?:name|property)="${name}" content="([^"]+)"`))?.[1];
  assert.match(html, /<title>[^<]{20,60}<\/title>/);
  assert.ok(meta('description').length <= 160, 'description fits a search snippet');
  assert.match(html, /<link rel="canonical" href="https:\/\/getsomae\.ai\/">/);
  for (const name of ['og:title', 'og:description', 'og:url', 'og:image:alt', 'twitter:card', 'twitter:title', 'twitter:image']) assert.ok(meta(name), `missing ${name}`);
  assert.equal(meta('og:image'), 'https://getsomae.ai/og.png');
  // PNG IHDR: width and height are the big-endian integers at bytes 16 and 20.
  const png = await readFile(new URL('og.png', publicDir));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [Number(meta('og:image:width')), Number(meta('og:image:height'))]);
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data['@type'], 'SoftwareApplication');
  assert.equal(data.url, 'https://getsomae.ai/');
});

test('template holes appear only inside the two demo figures', () => {
  assert.deepEqual(figures.map(match => match[1]), ['hero', 'review']);
  const outside = figures.reduce((page, [figure]) => page.replace(figure, ''), html);
  assert.deepEqual(holes(outside), []);
});

test('every demo hole resolves in every scene', () => {
  const check = (figure, scope, steps) => {
    for (const path of holes(figure)) {
      const value = path.startsWith('step.') ? lookup({ step: steps[0] }, path) : lookup(scope, path);
      assert.notEqual(value, undefined, `${path} is undefined`);
    }
  };
  const [[hero], [review]] = figures;
  for (const hp of [false, true]) {
    HERO_DURATIONS.forEach((_, hs) => {
      const h = heroView({ hs, hp });
      check(hero, { h }, h.steps);
    });
    REVIEW_DURATIONS.forEach((_, rs) => {
      const r = reviewView({ rs, rp: hp, rt: 1200 });
      check(review, { r }, r.steps);
    });
  }
});

test('the review demo types a note, saves it and ends on approval', () => {
  const state = initialState(false);
  const clock = { hero: 0, review: 0 };
  const scenes = [];
  for (let i = 0; i < REVIEW_DURATIONS.reduce((sum, ms) => sum + ms, 0) / 100; i++) {
    Object.assign(state, tick(state, clock, { hero: false, review: true }));
    scenes.push(reviewView(state));
  }
  assert.ok(scenes.some(r => r.composer && r.typed.length > 0 && 'Hold the reveal a beat longer.'.startsWith(r.typed)));
  const approved = scenes.find(r => r.versionLabel === 'Version 3 · approved');
  assert.equal(approved.toast, 'Approval sent with comments.');
  assert.equal(approved.history, 'Approved v3');
  assert.equal(state.hs, 0, 'an off-screen hero demo does not advance');
});

test('demo stages scale down only below their design width', () => {
  assert.deepEqual([...html.matchAll(/data-fit="(\d+)"/g)].map(match => match[1]), ['960', '1100']);
  assert.equal(fitScale(1152, 960), 1);
  assert.equal(fitScale(480, 960), 0.5);
  assert.equal(fitScale(0, 960), 1, 'an unmeasured frame is left alone');
});

test('reduced motion starts both demos paused on a still scene', () => {
  const state = initialState(true);
  assert.deepEqual(tick(state, { hero: 0, review: 0 }), {});
  assert.equal(heroView(state).showWindow, true);
  assert.equal(heroView(state).toggleText, 'Play');
  assert.equal(reviewView(state).toast, 'Comment saved.');
});
