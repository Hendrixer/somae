import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { classifyPath, checkEdges, scanImports, resolveImport, validateMap, checkRepository } from './check-boundaries.mjs';

const paths = {
  api: 'apps/api', desktop: 'apps/desktop', mobile: 'apps/mobile', domain: 'packages/domain',
  'design-system': 'packages/design-system', aura: 'prototypes/desktop', gather: 'prototypes/gather',
  signal: 'prototypes/signal', marks: 'prototypes/marks', 'prototype-shared': 'prototypes', tooling: 'scripts',
};
const prototypes = ['aura', 'gather', 'signal', 'marks', 'prototype-shared'];
const apps = ['api', 'desktop', 'mobile'];
const map = {
  schema_version: 1, audience: 'development_agents',
  nodes: Object.entries(paths).map(([id, path]) => ({ id, path, kind: 'package', status: 'reference', description: id,
    guide: `${path}/README.md`, entry_points: [`${path}/index.js`], ...(id === 'domain' ? { package_name: '@somae/domain' } : {}) })),
  relationships: [{ from: 'api', to: 'domain', type: 'uses', status: 'planned', description: 'Shared domain policy.' }],
  rules: [
    { id: 'REPO-001', from: apps, forbid: prototypes, description: 'Apps cannot import mock code.' },
    { id: 'REPO-002', from: ['domain'], forbid: [...apps, ...prototypes, 'design-system'], description: 'Domain is independent of UI and apps.' },
    { id: 'REPO-003', from: apps, forbid: apps, description: 'Apps cannot import each other.' },
    { id: 'REPO-004', from: prototypes, forbid: apps, description: 'Prototypes cannot import app implementations.' },
    { id: 'REPO-005', from: ['aura', 'gather', 'signal'], forbid: ['aura', 'gather', 'signal'], description: 'Explorations stay independent.' },
  ],
};
function edge(from, to) { return { importer: `${paths[from]}/index.js`, target: `${paths[to]}/index.js`, specifier: './example.js' }; }

test('documented application-to-domain and same-package imports are allowed', () => {
  assert.deepEqual(checkEdges(map, [edge('api', 'domain'), edge('desktop', 'domain'), edge('mobile', 'domain'), edge('signal', 'signal'), edge('domain', 'domain')]), []);
});

test('production apps cannot import prototype mock modules', () => {
  for (const app of apps) for (const prototype of prototypes) assert.ok(checkEdges(map, [edge(app, prototype)]).some(item => item.rule_id === 'REPO-001'));
});

test('domain UI coupling, cross-app imports and prototype-to-app imports fail', () => {
  assert.equal(checkEdges(map, [edge('domain', 'signal')])[0].rule_id, 'REPO-002');
  assert.equal(checkEdges(map, [edge('domain', 'design-system')])[0].rule_id, 'REPO-002');
  assert.equal(checkEdges(map, [edge('api', 'mobile')])[0].rule_id, 'REPO-003');
  assert.equal(checkEdges(map, [edge('signal', 'desktop')])[0].rule_id, 'REPO-004');
});

test('separate prototype imports fail while shared helpers remain allowed', () => {
  for (const [from, to] of [['aura', 'signal'], ['signal', 'gather'], ['gather', 'aura']]) assert.equal(checkEdges(map, [edge(from, to)])[0].rule_id, 'REPO-005');
  assert.deepEqual(checkEdges(map, [edge('signal', 'prototype-shared')]), []);
});

test('the checked-in repository map enforces the intended production/reference separation', async () => {
  const actual = JSON.parse(await readFile(new URL('../docs/architecture/repository-map.json', import.meta.url), 'utf8'));
  for (const app of apps) for (const prototype of prototypes) assert.ok(checkEdges(actual, [edge(app, prototype)]).some(item => item.rule_id === 'REPO-001'));
  for (const from of apps) for (const to of apps.filter(id => id !== from)) assert.ok(checkEdges(actual, [edge(from, to)]).some(item => item.rule_id.startsWith('REPO-003')));
  assert.ok(checkEdges(actual, [edge('domain', 'design-system')]).some(item => item.rule_id === 'REPO-002'));
  assert.ok(checkEdges(actual, [edge('domain', 'signal')]).some(item => item.rule_id === 'REPO-002'));
  assert.ok(checkEdges(actual, [edge('signal', 'desktop')]).some(item => item.rule_id === 'REPO-004'));
  assert.ok(checkEdges(actual, [edge('signal', 'gather')]).some(item => item.rule_id.startsWith('REPO-005')));
  assert.deepEqual(checkEdges(actual, [edge('api', 'domain'), edge('signal', 'signal'), edge('signal', 'prototype-shared')]), []);
});

test('classification normalizes parent traversals before choosing the most specific node', () => {
  assert.equal(classifyPath(map, 'prototypes/shared/../signal/archive/decision-v1/app.js'), 'signal');
  assert.equal(classifyPath(map, 'apps/api/../../prototypes/signal/app.js'), 'signal');
  assert.equal(classifyPath(map, '../apps/api/index.js'), null);
  const violations = checkEdges(map, [{ importer: 'apps/api/index.js', target: 'apps/api/../../prototypes/signal/app.js', specifier: '../../prototypes/signal/app.js' }]);
  assert.equal(violations[0].to, 'signal');
});

test('scanner reads literal ESM, re-exports, require and dynamic imports, ignoring strings/comments', () => {
  const source = [
    "import x from './a.js';", "import './side.js';", "export { x } from './b.js';",
    "export * from './c.js';", "import type { Shape } from './types.js';", "require('./d.js');",
    "import('./e.js');", "import('./f.js', { with: { type: 'json' } });",
    "const ignored = \"import('./fake.js')\";", "// import './comment.js';",
    "/* require('./comment2.js'); */", 'const template = `import("./template.js")`;',
    "import(path);", "require('./prefix/' + name);", "object.require('./method.js');",
  ].join('\n');
  const result = scanImports(source);
  assert.deepEqual(result.edges.map(item => item.specifier), ['./a.js', './side.js', './b.js', './c.js', './types.js', './d.js', './e.js', './f.js']);
  assert.equal(result.unsupported.length, 2);
  assert.equal(result.edges[0].line, 1);
});

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'somae-boundaries-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const node of map.nodes) {
    await mkdir(resolve(root, node.path), { recursive: true });
    await writeFile(resolve(root, node.guide), `# ${node.id}\n`);
    await writeFile(resolve(root, node.entry_points[0]), 'export const value = 1;\n');
    if (node.package_name) await writeFile(resolve(root, node.path, 'package.json'), JSON.stringify({ name: node.package_name }));
  }
  return root;
}

test('filesystem resolution supports workspace package names, subpaths and TS declarations', async t => {
  const root = await fixture(t);
  await writeFile(resolve(root, 'packages/domain/types.d.ts'), 'export interface Shape {}\n');
  assert.equal((await resolveImport(root, map, 'apps/api/index.js', '@somae/domain')).target, 'packages/domain/index.js');
  assert.equal((await resolveImport(root, map, 'apps/api/index.js', '@somae/domain/types.js')).target, 'packages/domain/types.d.ts');
  assert.equal((await resolveImport(root, map, 'apps/api/index.js', '../../packages/domain/index')).target, 'packages/domain/index.js');
  assert.equal((await resolveImport(root, map, 'apps/api/index.js', '../../../private.js')).resolution, 'outside-repository');
  assert.equal((await resolveImport(root, map, 'apps/api/index.js', './missing.js')).resolution, 'unresolved-local');
  assert.equal((await resolveImport(root, map, 'apps/api/index.js', 'node:fs')).resolution, 'builtin');
});

test('map validates references and scan rejects forbidden edges without changing source', async t => {
  const root = await fixture(t);
  assert.deepEqual(await validateMap(root, map), []);
  const source = "import { value } from '../../prototypes/signal/index.js';\nimport '@somae/domain';\n";
  await writeFile(resolve(root, 'apps/api/index.js'), source);
  const report = await checkRepository(root, map);
  assert.equal(report.ok, false);
  assert.equal(report.violations[0].rule_id, 'REPO-001');
  assert.equal(report.import_edges.length, 2);
  assert.equal(report.resolution_errors.length, 0);
  assert.equal(await readFile(resolve(root, 'apps/api/index.js'), 'utf8'), source);
  const duplicate = structuredClone(map);
  duplicate.nodes.push(duplicate.nodes[0]);
  assert.ok((await validateMap(root, duplicate)).some(item => item.includes('duplicate node ID')));
  const broken = structuredClone(map);
  broken.relationships[0].to = 'unknown';
  broken.rules[0].forbid.push('unknown');
  assert.ok((await validateMap(root, broken)).some(item => item.includes('unknown node')));
  await writeFile(resolve(root, 'apps/api/index.js'), "import './missing.js';\n");
  const unresolved = await checkRepository(root, map);
  assert.equal(unresolved.ok, false);
  assert.equal(unresolved.resolution_errors[0].resolution, 'unresolved-local');
});

test('workspace package registry mismatches and unmapped internal names fail closed', async t => {
  const root = await fixture(t);
  const mismatched = structuredClone(map);
  mismatched.nodes.find(node => node.id === 'domain').package_name = '@somae/typo';
  assert.ok((await validateMap(root, mismatched)).some(item => item.includes('package_name does not match')));
  await writeFile(resolve(root, 'apps/api/index.js'), "import '@somae/unknown-prototype';\n");
  const report = await checkRepository(root, map);
  assert.equal(report.ok, false);
  assert.equal(report.resolution_errors[0].resolution, 'unknown-workspace-package');
});
