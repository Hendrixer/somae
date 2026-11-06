import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { getOntology, createRuntime, verifyState, CAPABILITIES } from './index.js';
import { createFixture } from './fixtures.js';

const directory = fileURLToPath(new URL('.', import.meta.url));
const repository = resolve(directory, '../..');
const ontology = getOntology();
const schema = JSON.parse(readFileSync(new URL('./ontology.schema.json', import.meta.url), 'utf8'));

// Dependency-free validator for the JSON Schema vocabulary actually used by our metadata.
// Runtime semantic command validation lives at execute(); this is documentation drift QA.
function validate(value, spec, path = '$') {
  const kind = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  if (spec.type) assert.equal(kind, spec.type, `${path}: type`);
  if (Object.hasOwn(spec, 'const')) assert.deepEqual(value, spec.const, `${path}: const`);
  if (spec.enum) assert.ok(spec.enum.some(item => JSON.stringify(item) === JSON.stringify(value)), `${path}: enum`);
  if (spec.pattern) assert.match(value, new RegExp(spec.pattern), `${path}: pattern`);
  if (kind === 'object') {
    for (const key of spec.required ?? []) assert.ok(Object.hasOwn(value, key), `${path}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      const child = spec.properties?.[key] ?? spec.additionalProperties;
      assert.notEqual(child, false, `${path}.${key}: extra field`);
      if (child && typeof child === 'object') validate(item, child, `${path}.${key}`);
    }
  }
  if (kind === 'array') {
    assert.ok(value.length >= (spec.minItems ?? 0), `${path}: minItems`);
    if (spec.uniqueItems) assert.equal(new Set(value.map(item => JSON.stringify(item))).size, value.length, `${path}: uniqueItems`);
    if (spec.items) value.forEach((item, index) => validate(item, spec.items, `${path}[${index}]`));
  }
}
validate(ontology, schema);
assert.deepEqual(CAPABILITIES, ontology.enums.capability);
const names = ontology.entities.map(entity => entity.name);
assert.equal(new Set(names).size, names.length, 'Entity names must be unique');
for (const relationship of ontology.relationships) {
  assert.ok(names.includes(relationship.from) && names.includes(relationship.to), 'Relationship endpoints must exist');
}
const files = ontology.test_sources ?? readdirSync(directory).filter(file => file.endsWith('.test.js')).map(file => `packages/domain/${file}`);
const sources = files.map(file => {
  const full = resolve(repository, file);
  assert.ok(full.startsWith(`${repository}/`) && existsSync(full), `Test source must exist inside the repo: ${file}`);
  return readFileSync(full, 'utf8');
}).join('\n');
const titlePatterns = [...sources.matchAll(/\btest\(\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)/g)].map(match => {
  const literal = match[1], title = literal.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"');
  const escaped = title.split(/(\$\{[^}]+\})/g).map(part => part.startsWith('${') ? '.+?' : part.replace(/[.*+?^$()|[\]\\]/g, '\\$&')).join('');
  return new RegExp(`^${escaped}$`);
});
assert.ok(titlePatterns.length, 'Domain tests must exist');
const ruleIds = new Set();
for (const rule of ontology.rules) {
  assert.ok(!ruleIds.has(rule.id), `Duplicate rule ${rule.id}`); ruleIds.add(rule.id);
  for (const enforcement of rule.enforcement) {
    const [path, symbol] = enforcement.split('#');
    const full = resolve(repository, path);
    assert.ok(full.startsWith(`${repository}/`) && existsSync(full), `${rule.id}: enforcement file must exist`);
    if (symbol) assert.match(readFileSync(full, 'utf8'), new RegExp(`\\bfunction\\s+${symbol}\\b`), `${rule.id}: enforcement function must exist`);
  }
  for (const name of rule.tests) assert.ok(titlePatterns.some(pattern => pattern.test(name)), `${rule.id}: test title does not exist: ${name}`);
}
for (const kind of ['local_coding', 'hosted_coding', 'custom_turn_based', 'custom_durable']) {
  const fixture = createFixture(kind);
  assert.deepEqual(verifyState(fixture.seed), []);
  assert.deepEqual(createRuntime({ seed: fixture.seed }).snapshot(), fixture.seed);
}
console.log(`Domain metadata valid: ${names.length} entities, ${Object.keys(ontology.commands).length} commands, ${ontology.rules.length} enforced rule records with test references.`);
