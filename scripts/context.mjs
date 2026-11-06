import { readFile, stat } from 'node:fs/promises';
import { posix, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const aliases = {
  signal: ['signal', 'signal-ui'], domain: ['domain', 'business-rule'],
  design: ['design-system', 'design-tokens'],
  repo: [null, 'new-application-or-package'], workflow: [null, null],
};
const normalize = value => posix.normalize(String(value).replaceAll('\\', '/')).replace(/^\.\//, '').replace(/\/$/, '');
const safe = value => value !== '..' && !value.startsWith('../') && !posix.isAbsolute(value) && !/^[a-z]:/i.test(value);
const unique = values => [...new Set(values.filter(Boolean))];
const sourcePath = reference => normalize(reference.split('#')[0]);

function nodeForPath(map, value) {
  const path = normalize(value);
  if (!safe(path)) return undefined;
  return map.nodes.filter(node => path === normalize(node.path) || path.startsWith(`${normalize(node.path)}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

// This is a lookup over the maintained map and ontology, not a second knowledge store.
export function getContext(map, ontology, queries = []) {
  const nodes = new Map();
  const recipes = new Map();
  const warnings = [];
  const paths = [];
  const addNode = node => { if (node) nodes.set(node.id, node); };
  const addRecipe = scope => {
    const recipe = map.change_recipes.find(item => item.scope === scope);
    if (recipe) recipes.set(recipe.scope, recipe);
    else warnings.push(`No change recipe is mapped for ${scope}. Use the root guide and full verification.`);
  };
  for (const raw of queries) {
    const query = normalize(raw.trim());
    if (Object.hasOwn(aliases, query)) {
      const [id, scope] = aliases[query];
      addNode(map.nodes.find(node => node.id === id));
      if (scope) addRecipe(scope);
      continue;
    }
    const node = map.nodes.find(item => item.id === query || item.package_name === query) ?? nodeForPath(map, query);
    if (node) {
      addNode(node);
      paths.push(query);
      for (const recipe of map.change_recipes) {
        if (recipe.edit.some(path => nodeForPath(map, path)?.id === node.id)) recipes.set(recipe.scope, recipe);
      }
      if (node.kind === 'app' && node.status === 'planned') addRecipe('new-application-or-package');
      continue;
    }
    if (map.change_recipes.some(recipe => recipe.scope === query)) {
      addRecipe(query);
      for (const path of recipes.get(query).edit) addNode(nodeForPath(map, path));
      continue;
    }
    paths.push(query);
    warnings.push(`No mapped context for "${raw}". Start with the root guide and run full verification; do not assume there are no relevant rules.`);
  }
  for (const node of nodes.values()) {
    if (node.status === 'planned') warnings.push(`${node.id} is planned: its directory is a placeholder, not a working application.`);
    if (node.status === 'preserved') warnings.push(`${node.id} is preserved: keep this exploration intact unless the requested change includes it.`);
  }
  const selected = [...nodes.values()];
  const selectedRecipes = [...recipes.values()];
  const rules = ontology.rules.filter(rule => nodes.has('domain') || paths.some(path =>
    rule.enforcement.some(ref => sourcePath(ref) === path || sourcePath(ref).startsWith(`${path}/`))
  )).map(({ id, description, enforcement, tests }) => ({ id, description, enforcement, tests }));
  return {
    queries: [...queries], nodes: selected,
    read: unique([
      ...map.developer_entry_points, 'docs/architecture/repository-map.json',
      ...selected.flatMap(node => [node.guide, ...node.entry_points]),
      ...selectedRecipes.flatMap(recipe => recipe.read),
    ]),
    checks: unique([...selectedRecipes.flatMap(recipe => recipe.verify), 'npm run verify']),
    rules, warnings: unique(warnings),
  };
}

export async function validateContextReferences(root, map, _ontology) {
  const errors = [];
  const refs = [];
  let scripts;
  try { scripts = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).scripts; }
  catch (error) { if (error.code !== 'ENOENT') errors.push(`Cannot read check commands: ${error.message}`); }
  if (!Array.isArray(map.developer_entry_points) || !map.developer_entry_points.length) errors.push('developer_entry_points must be a nonempty array.');
  else refs.push(...map.developer_entry_points.map(path => ['developer_entry_points', path]));
  refs.push(['business_model', map.business_model]);
  for (const node of map.nodes ?? []) {
    refs.push([`${node.id}.guide`, node.guide]);
    for (const path of node.entry_points ?? []) refs.push([`${node.id}.entry_points`, path]);
  }
  if (!Array.isArray(map.change_recipes)) errors.push('change_recipes must be an array.');
  else {
    const scopes = new Set();
    for (const recipe of map.change_recipes) {
      if (typeof recipe.scope !== 'string' || !recipe.scope || scopes.has(recipe.scope)) errors.push(`Invalid or duplicate change recipe: ${recipe.scope}`);
      scopes.add(recipe.scope);
      for (const field of ['read', 'edit']) {
        if (!Array.isArray(recipe[field])) errors.push(`${recipe.scope}.${field} must be an array.`);
        else refs.push(...recipe[field].map(path => [`${recipe.scope}.${field}`, path]));
      }
      if (!Array.isArray(recipe.verify) || !recipe.verify.length || recipe.verify.some(check => typeof check !== 'string' || !check)) errors.push(`${recipe.scope}.verify must contain check instructions.`);
      else if (scripts) for (const instruction of recipe.verify) {
        const command = instruction.match(/^npm run ([\w:-]+)(?:\s|$)/)?.[1];
        if (command && !Object.hasOwn(scripts, command)) errors.push(`${recipe.scope}.verify: missing npm script ${command}`);
      }
    }
  }
  for (const [label, path] of refs) {
    if (typeof path !== 'string' || !path || !safe(normalize(path))) { errors.push(`${label}: unsafe or invalid file reference ${path}`); continue; }
    try { if (!(await stat(resolve(root, path))).isFile()) errors.push(`${label}: reference is not a file: ${path}`); }
    catch { errors.push(`${label}: missing file reference ${path}`); }
  }
  return errors;
}

// Reuse the existing verification report as a reminder; no tracked freshness store.
export function reviewContext(map, ontology, currentFiles, previousFiles) {
  const note = 'Review the affected guides and update them if behavior or usage changed. This is a source-change reminder, not semantic verification.';
  if (!previousFiles) return { status: 'baseline_created', changed_files: [], read: [], note };
  const changed = unique([...Object.keys(currentFiles), ...Object.keys(previousFiles)]).filter(path => currentFiles[path] !== previousFiles[path]).sort();
  return { status: changed.length ? 'review_suggested' : 'unchanged', changed_files: changed, read: changed.length ? getContext(map, ontology, changed).read : [], note };
}

function printContext(context) {
  console.log(context.queries.length ? `Context: ${context.queries.join(', ')}` : 'Start with the guides below. Use npm run context -- signal, domain, design, api, desktop, mobile, or a repository path.');
  if (context.nodes.length) console.log(`\nScope:\n${context.nodes.map(node => `- ${node.id} (${node.status}): ${node.path} — ${node.description}`).join('\n')}`);
  console.log(`\nRead:\n${context.read.map(path => `- ${path}`).join('\n')}`);
  console.log(`\nCheck:\n${context.checks.map(check => `- ${check}`).join('\n')}`);
  if (context.rules.length) console.log(`\nBusiness rules:\n${context.rules.map(rule => `- ${rule.id}: ${rule.description}\n  Enforcement: ${rule.enforcement.join(', ')}\n  Tests: ${rule.tests.join('; ')}`).join('\n')}`);
  if (context.warnings.length) console.log(`\nNotes:\n${context.warnings.map(warning => `- ${warning}`).join('\n')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  try {
    const map = JSON.parse(await readFile(resolve(root, 'docs/architecture/repository-map.json'), 'utf8'));
    const args = process.argv.slice(2);
    const unsupported = args.filter(arg => arg.startsWith('--') && !['--json', '--check'].includes(arg));
    if (unsupported.length) throw new Error(`Unknown option: ${unsupported.join(', ')}`);
    const errors = await validateContextReferences(root, map);
    if (errors.length) throw new Error(errors.join('\n'));
    if (args.includes('--check')) console.log('Developer context references are valid.');
    else {
      const ontology = JSON.parse(await readFile(resolve(root, map.business_model), 'utf8'));
      const queries = args.filter(arg => !arg.startsWith('--')).map(arg => posix.isAbsolute(arg) ? relative(root, arg).replaceAll('\\', '/') : arg);
      const context = getContext(map, ontology, queries);
      if (args.includes('--json')) console.log(JSON.stringify(context, null, 2));
      else printContext(context);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
