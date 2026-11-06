import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const excluded = new Set(['.git', '.hutch', '.cottontail-tmp', '.wrangler', 'build', 'node_modules', 'dist', '.openai', 'coverage', 'artifacts']);
const extensions = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.d.ts'];
export const limitations = [
  'A lightweight lexical scanner finds literal ESM imports/re-exports, import(), and require() in JavaScript/TypeScript source. It is not an AST, TypeScript compiler, bundler, or runtime proof.',
  'Nonliteral imports, template literals (including their expressions), runtime loaders, file reads, HTML/CSS references, and generated/excluded files are not dependency edges here.',
  'Known package names resolve using repository-map package_name and its documented first entry point; unknown aliases and external packages are reported but not resolved. Unmapped @somae/* names fail closed. No tsconfig or bundler alias resolution is implied.',
];

function normalize(path) { return posix.normalize(path.replaceAll('\\', '/')).replace(/^\.\//, '').replace(/\/$/, ''); }
function inside(path) { return path !== '..' && !path.startsWith('../') && !posix.isAbsolute(path); }
function repoPath(root, path) { return relative(root, path).split(sep).join('/'); }
async function fileExists(path) { try { return (await stat(path)).isFile(); } catch { return false; } }

export function classifyPath(map, path) {
  const normalized = normalize(path);
  if (!inside(normalized)) return null;
  return map.nodes.filter(node => normalized === normalize(node.path) || normalized.startsWith(`${normalize(node.path)}/`))
    .sort((a, b) => normalize(b.path).length - normalize(a.path).length)[0]?.id ?? null;
}

export function checkEdges(map, edges) {
  const violations = [];
  for (const edge of edges) {
    const from = classifyPath(map, edge.importer);
    const to = edge.target ? classifyPath(map, edge.target) : null;
    if (!from || !to || from === to) continue;
    for (const rule of map.rules) {
      if (rule.from.includes(from) && rule.forbid.includes(to)) violations.push({
        rule_id: rule.id, importer: normalize(edge.importer), specifier: edge.specifier,
        target: normalize(edge.target), from, to, line: edge.line ?? null, description: rule.description,
      });
    }
  }
  return violations;
}

// Skip comments and quoted content before looking for import tokens. This avoids
// treating fixture strings and explanatory comments as actual dependency edges.
function tokens(source) {
  const result = [];
  let i = 0;
  let line = 1;
  function advance() { if (source[i] === '\n') line++; i++; }
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) { advance(); continue; }
    if (source.startsWith('//', i)) { while (i < source.length && source[i] !== '\n') advance(); continue; }
    if (source.startsWith('/*', i)) { advance(); advance(); while (i < source.length && !source.startsWith('*/', i)) advance(); if (i < source.length) { advance(); advance(); } continue; }
    if (ch === '`') {
      advance();
      while (i < source.length && source[i] !== '`') { if (source[i] === '\\') advance(); if (i < source.length) advance(); }
      if (i < source.length) advance();
      continue;
    }
    if (ch === '"' || ch === "'") {
      const startLine = line;
      const quote = ch;
      let value = '';
      advance();
      while (i < source.length && source[i] !== quote) {
        if (source[i] !== '\\') { value += source[i]; advance(); continue; }
        advance();
        const escape = source[i];
        if (escape === '\n' || escape === '\r') { advance(); continue; }
        const hexLength = escape === 'x' ? 2 : escape === 'u' ? 4 : 0;
        if (hexLength && new RegExp(`^[a-f\\d]{${hexLength}}$`, 'i').test(source.slice(i + 1, i + 1 + hexLength))) {
          value += String.fromCharCode(parseInt(source.slice(i + 1, i + 1 + hexLength), 16));
          for (let j = 0; j <= hexLength; j++) advance();
        } else {
          value += ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v' })[escape] ?? escape ?? '';
          if (i < source.length) advance();
        }
      }
      if (i < source.length) advance();
      result.push({ type: 'string', value, line: startLine });
      continue;
    }
    if (/[a-z_$]/i.test(ch)) {
      const start = i;
      const startLine = line;
      while (i < source.length && /[\w$]/.test(source[i])) advance();
      result.push({ type: 'word', value: source.slice(start, i), line: startLine });
      continue;
    }
    result.push({ type: 'punctuation', value: ch, line });
    advance();
  }
  return result;
}

export function scanImports(source) {
  const lexemes = tokens(source);
  const edges = [];
  const unsupported = [];
  const add = (token, specifier, kind) => edges.push({ specifier: specifier.value, line: token.line, kind });
  for (let i = 0; i < lexemes.length; i++) {
    const token = lexemes[i];
    if (token.type !== 'word' || !['import', 'export', 'require'].includes(token.value)) continue;
    if (['.', '?'].includes(lexemes[i - 1]?.value)) continue;
    const next = lexemes[i + 1];
    if ((token.value === 'import' || token.value === 'require') && next?.value === '(') {
      if (lexemes[i + 2]?.type === 'string' && [')', ','].includes(lexemes[i + 3]?.value)) add(token, lexemes[i + 2], token.value === 'import' ? 'dynamic-import' : 'require');
      else unsupported.push({ line: token.line, kind: token.value, reason: 'Nonliteral or compound module expression is outside this scanner.' });
      continue;
    }
    if (token.value === 'require' || next?.value === '.' || next?.value === ':') continue;
    if (token.value === 'import' && next?.type === 'string') { add(token, next, 'import'); continue; }
    // Named declarations cannot be re-exports. Stop before their bodies instead
    // of interpreting a later unrelated identifier named `from` as an import.
    if (token.value === 'export' && !['{', '*', 'type'].includes(next?.value)) continue;
    for (let j = i + 1; j < lexemes.length; j++) {
      const current = lexemes[j];
      if (current.value === ';' || (j > i + 1 && current.type === 'word' && ['import', 'export'].includes(current.value))) break;
      if (current.type === 'word' && current.value === 'from' && lexemes[j + 1]?.type === 'string') { add(token, lexemes[j + 1], token.value === 'import' ? 'import' : 're-export'); break; }
    }
  }
  return { edges, unsupported };
}

export async function validateMap(root, map) {
  const errors = [];
  if (map.schema_version !== 1 || map.audience !== 'development_agents') errors.push('Map must have schema_version 1 and audience development_agents.');
  for (const field of ['nodes', 'relationships', 'rules']) if (!Array.isArray(map[field])) errors.push(`${field} must be an array.`);
  if (errors.length) return errors;
  const ids = new Set();
  const paths = new Set();
  const packages = new Set();
  for (const node of map.nodes) {
    if (typeof node.id !== 'string' || !node.id || ids.has(node.id)) errors.push(`Invalid or duplicate node ID: ${node.id}`);
    ids.add(node.id);
    if (typeof node.path !== 'string' || !node.path || !inside(normalize(node.path))) { errors.push(`${node.id}: path must stay in the repository.`); continue; }
    const path = normalize(node.path);
    if (paths.has(path)) errors.push(`${node.id}: duplicate node path ${path}`);
    paths.add(path);
    try { if (!(await stat(resolve(root, path))).isDirectory()) errors.push(`${node.id}: path is not a directory.`); }
    catch { errors.push(`${node.id}: missing directory ${path}`); }
    for (const field of ['kind', 'status', 'description', 'guide']) if (typeof node[field] !== 'string' || !node[field]) errors.push(`${node.id}: missing ${field}.`);
    if (!Array.isArray(node.entry_points) || !node.entry_points.length) errors.push(`${node.id}: entry_points must be a nonempty array.`);
    for (const entry of [...(Array.isArray(node.entry_points) ? node.entry_points : []), node.guide]) {
      if (typeof entry !== 'string' || !inside(normalize(entry)) || !await fileExists(resolve(root, entry))) errors.push(`${node.id}: missing or unsafe file reference ${entry}`);
    }
    if (node.package_name) {
      if (typeof node.package_name !== 'string' || packages.has(node.package_name)) errors.push(`${node.id}: invalid or duplicate package_name.`);
      packages.add(node.package_name);
      try {
        const manifest = JSON.parse(await readFile(resolve(root, path, 'package.json'), 'utf8'));
        if (manifest.name !== node.package_name) errors.push(`${node.id}: package_name does not match ${path}/package.json name.`);
      } catch { errors.push(`${node.id}: package_name requires a readable ${path}/package.json.`); }
    }
  }
  for (const edge of map.relationships) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) errors.push(`Relationship references an unknown node: ${edge.from} -> ${edge.to}`);
    for (const field of ['type', 'status', 'description']) if (typeof edge[field] !== 'string' || !edge[field]) errors.push(`Relationship ${edge.from} -> ${edge.to}: missing ${field}.`);
  }
  const rules = new Set();
  for (const rule of map.rules) {
    if (typeof rule.id !== 'string' || !rule.id || rules.has(rule.id)) errors.push(`Invalid or duplicate rule ID: ${rule.id}`);
    rules.add(rule.id);
    if (typeof rule.description !== 'string' || !rule.description) errors.push(`${rule.id}: missing description.`);
    for (const field of ['from', 'forbid']) {
      if (!Array.isArray(rule[field]) || !rule[field].length || rule[field].some(id => !ids.has(id))) errors.push(`${rule.id}: ${field} must reference known nodes.`);
    }
  }
  return errors;
}

async function walk(root, directory = '') {
  const files = [];
  for (const entry of (await readdir(resolve(root, directory), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (excluded.has(entry.name) || entry.name.startsWith('.env') || entry.isSymbolicLink()) continue;
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await walk(root, path));
    else if (entry.isFile() && ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'].includes(extname(path))) files.push(path);
  }
  return files;
}

export async function resolveImport(root, map, importer, specifier) {
  let candidate;
  let kind;
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    candidate = specifier.startsWith('/') ? resolve(root, `.${specifier}`) : resolve(root, dirname(importer), specifier);
    kind = 'relative';
  } else {
    const node = map.nodes.filter(node => node.package_name && (specifier === node.package_name || specifier.startsWith(`${node.package_name}/`)))
      .sort((a, b) => b.package_name.length - a.package_name.length)[0];
    if (!node) return { resolution: specifier.startsWith('node:') ? 'builtin' : specifier.startsWith('@somae/') ? 'unknown-workspace-package' : 'external-or-unknown-alias', target: null };
    candidate = resolve(root, specifier === node.package_name ? node.entry_points[0] : `${node.path}/${specifier.slice(node.package_name.length + 1)}`);
    kind = 'workspace-package';
  }
  const path = repoPath(root, candidate);
  if (!inside(path)) return { resolution: 'outside-repository', target: path };
  const candidates = [candidate, ...extensions.map(extension => candidate + extension), ...extensions.map(extension => resolve(candidate, `index${extension}`))];
  // TypeScript declarations can refer to the JavaScript output filename.
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(extname(candidate))) {
    const base = candidate.slice(0, -extname(candidate).length);
    candidates.push(...['.ts', '.tsx', '.d.ts'].map(extension => base + extension));
  }
  for (const possible of candidates) if (await fileExists(possible)) return { resolution: kind, target: repoPath(root, possible) };
  return { resolution: 'unresolved-local', target: path };
}

export async function checkRepository(root, map) {
  const mapErrors = await validateMap(root, map);
  const report = {
    schema_version: 1, audience: 'development_agents', nodes: map.nodes ?? [], relationships: map.relationships ?? [],
    rules: map.rules ?? [], import_edges: [], violations: [], map_errors: mapErrors, resolution_errors: [], unsupported: [], limitations,
  };
  if (mapErrors.length) { report.ok = false; return report; }
  for (const importer of await walk(root)) {
    const scanned = scanImports(await readFile(resolve(root, importer), 'utf8'));
    report.unsupported.push(...scanned.unsupported.map(item => ({ importer, ...item })));
    for (const edge of scanned.edges) {
      const resolved = await resolveImport(root, map, importer, edge.specifier);
      const record = { importer, ...edge, ...resolved, from: classifyPath(map, importer), to: resolved.target ? classifyPath(map, resolved.target) : null };
      report.import_edges.push(record);
      if (['unresolved-local', 'outside-repository', 'unknown-workspace-package'].includes(resolved.resolution)) report.resolution_errors.push(record);
    }
  }
  report.violations = checkEdges(map, report.import_edges);
  report.ok = !report.violations.length && !report.resolution_errors.length;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  try {
    const map = JSON.parse(await readFile(resolve(root, 'docs/architecture/repository-map.json'), 'utf8'));
    const report = await checkRepository(root, map);
    const output = resolve(root, 'artifacts/verification/repository-graph.json');
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`${report.import_edges.length} literal import edges; ${report.violations.length} boundary violations; ${report.resolution_errors.length} resolution errors. Report: artifacts/verification/repository-graph.json`);
    if (!report.ok) console.error(JSON.stringify({ map_errors: report.map_errors, violations: report.violations, resolution_errors: report.resolution_errors }, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
