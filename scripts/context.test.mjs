import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { getContext, validateContextReferences, reviewContext } from './context.mjs';

const node = (id, path, status = 'current', kind = 'package') => ({ id, path, status, kind, description: id, guide: `${path}/README.md`, entry_points: [`${path}/index.js`] });
const map = {
  developer_entry_points: ['AGENTS.md', 'README.md', 'docs/WORKFLOW.md'], business_model: 'packages/domain/ontology.json',
  nodes: [node('prototype-shared', 'prototypes'), node('signal', 'prototypes/signal', 'current', 'prototype'), node('domain', 'packages/domain'), node('design-system', 'packages/design-system'), node('api', 'apps/api', 'planned', 'app')],
  change_recipes: [
    { scope: 'signal-ui', read: ['prototypes/signal/README.md', 'prototypes/signal/DESIGN-REVIEW.md'], edit: ['prototypes/signal/app.js'], verify: ['npm run verify', 'Browser: keyboard and narrow width'] },
    { scope: 'business-rule', read: ['packages/domain/ontology.json'], edit: ['packages/domain/index.js'], verify: ['npm run check:domain', 'npm run verify'] },
    { scope: 'design-tokens', read: ['packages/design-system/README.md'], edit: ['packages/design-system/tokens.json'], verify: ['npm run check:design'] },
    { scope: 'new-application-or-package', read: ['AGENTS.md', 'docs/WORKFLOW.md'], edit: ['package.json'], verify: ['npm run verify', 'Add compiler/build checks'] },
  ],
};
const ontology = { rules: [
  { id: 'RULE-1', description: 'Reject stale revisions.', enforcement: ['packages/domain/index.js#respond'], tests: ['reject stale response'] },
  { id: 'RULE-2', description: 'Keep view state separate.', enforcement: ['packages/domain/view.js#clear'], tests: ['clear only view'] },
] };

test('no arguments provide the maintained start guides and full verification', () => {
  const context = getContext(map, ontology);
  assert.deepEqual(context.nodes, []);
  assert.deepEqual(context.read, [...map.developer_entry_points, 'docs/architecture/repository-map.json']);
  assert.deepEqual(context.checks, ['npm run verify']);
  assert.deepEqual(context.rules, []);
});

test('aliases select recipes, deduplicate references and avoid irrelevant business rules', () => {
  const context = getContext(map, ontology, ['signal', 'design', 'signal']);
  assert.deepEqual(context.nodes.map(node => node.id), ['signal', 'design-system']);
  assert.equal(context.read.filter(path => path === 'prototypes/signal/README.md').length, 1);
  assert.equal(context.checks.filter(check => check === 'npm run verify').length, 1);
  assert.ok(context.checks.includes('npm run check:design'));
  assert.ok(context.checks.some(check => check.startsWith('Browser:')));
  assert.deepEqual(context.rules, []);
});

test('path routing uses the longest prefix and normalizes dot segments and separators', () => {
  const context = getContext(map, ontology, ['./prototypes\\signal/../signal/app.js']);
  assert.deepEqual(context.nodes.map(node => node.id), ['signal']);
  assert.ok(context.read.includes('prototypes/signal/DESIGN-REVIEW.md'));
  assert.deepEqual(getContext(map, ontology, ['prototypes/signal-extra/file.js']).nodes.map(node => node.id), ['prototype-shared']);
});

test('domain selection returns the existing ontology evidence', () => {
  const context = getContext(map, ontology, ['packages/domain/index.js']);
  assert.deepEqual(context.rules, ontology.rules);
  assert.ok(context.checks.includes('npm run check:domain'));
  assert.ok(context.read.includes('packages/domain/ontology.json'));
  assert.equal(getContext(map, ontology, ['signal']).rules.length, 0);
});

test('an enforcement path can supply related rules even without a map node', () => {
  const sparseMap = { ...map, nodes: map.nodes.filter(node => node.id !== 'domain') };
  const context = getContext(sparseMap, ontology, ['packages/domain/view.js']);
  assert.deepEqual(context.rules.map(rule => rule.id), ['RULE-2']);
  assert.ok(context.warnings.length);
});

test('unknown and unsafe input keep root guides and verification with an explicit warning', () => {
  for (const query of ['totally unknown', 'constructor', 'toString', '../../outside.js', '/outside.js']) {
    const context = getContext(map, ontology, [query]);
    assert.deepEqual(context.nodes, []);
    assert.ok(context.read.includes('AGENTS.md'));
    assert.ok(context.checks.includes('npm run verify'));
    assert.match(context.warnings[0], /No mapped context/);
  }
});

test('planned applications and repo/workflow route to the introduction recipe', () => {
  const app = getContext(map, ontology, ['api']);
  assert.ok(app.warnings.some(warning => warning.includes('placeholder')));
  assert.ok(app.checks.includes('Add compiler/build checks'));
  assert.ok(app.read.includes('apps/api/README.md'));
  assert.deepEqual(getContext(map, ontology, ['workflow']).checks, ['npm run verify']);
  assert.ok(getContext(map, ontology, ['workflow']).read.includes('docs/WORKFLOW.md'));
});

test('reference validation detects missing recipe reads/edits and unsafe root references', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'somae-context-'));
  const fixture = { developer_entry_points: ['AGENTS.md'], business_model: 'ontology.json', change_recipes: [{ scope: 'ui', read: ['guide.md'], edit: ['src/app.js'], verify: ['npm run verify'] }] };
  try {
    await mkdir(resolve(root, 'src'));
    for (const path of ['AGENTS.md', 'ontology.json', 'guide.md', 'src/app.js']) await writeFile(resolve(root, path), 'fixture');
    assert.deepEqual(await validateContextReferences(root, fixture, ontology), []);
    await rm(resolve(root, 'guide.md'));
    await rm(resolve(root, 'src/app.js'));
    const errors = await validateContextReferences(root, { ...fixture, developer_entry_points: ['../outside.md'] }, ontology);
    assert.equal(errors.length, 3);
    assert.ok(errors.some(error => error.includes('ui.read') && error.includes('guide.md')));
    assert.ok(errors.some(error => error.includes('ui.edit') && error.includes('src/app.js')));
    assert.ok(errors.some(error => error.includes('unsafe')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a source change suggests its maintained guides, and a deleted path is still included', () => {
  const review = reviewContext(map, ontology, { 'prototypes/signal/app.js': 'new' }, { 'prototypes/signal/app.js': 'old', 'packages/domain/index.js': 'deleted' });
  assert.equal(review.status, 'review_suggested');
  assert.deepEqual(review.changed_files, ['packages/domain/index.js', 'prototypes/signal/app.js']);
  assert.ok(review.read.includes('prototypes/signal/DESIGN-REVIEW.md'));
  assert.ok(review.read.includes('packages/domain/ontology.json'));
  assert.match(review.note, /not semantic verification/);
  assert.equal(reviewContext(map, ontology, { source: 'same' }, { source: 'same' }).status, 'unchanged');
  assert.equal(reviewContext(map, ontology, { source: 'first-run' }).status, 'baseline_created');
});

test('renamed check commands are flagged rather than returned as usable context', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'somae-context-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of ['AGENTS.md', 'ontology.json']) await writeFile(resolve(root, file), 'fixture');
  await writeFile(resolve(root, 'package.json'), JSON.stringify({ scripts: { verify: 'node verify.mjs' } }));
  const fixture = { developer_entry_points: ['AGENTS.md'], business_model: 'ontology.json', change_recipes: [{ scope: 'domain', read: [], edit: [], verify: ['npm run missing-check', 'Browser: review'] }] };
  assert.match((await validateContextReferences(root, fixture)).join('\n'), /missing npm script missing-check/);
});
