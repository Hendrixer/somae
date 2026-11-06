import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewContext } from './context.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const jsonIndex = args.indexOf('--json');
const reportPath = jsonIndex < 0 ? 'artifacts/verification/latest.json' : args[jsonIndex + 1];
if (!reportPath || args.some((arg, index) => !['--verbose', '--json'].includes(arg) && !(jsonIndex >= 0 && index === jsonIndex + 1))) {
  console.error('Usage: npm run verify -- [--verbose] [--json artifacts/verification/latest.json]');
  process.exit(2);
}

const excluded = new Set(['.git', '.openai', '.hutch', '.cottontail-tmp', '.wrangler', 'build', 'node_modules', 'dist', 'coverage', 'artifacts']);
async function filesIn(directory) {
  let entries;
  try { entries = await readdir(resolve(root, directory), { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (excluded.has(entry.name) || entry.name.startsWith('.env') || entry.isSymbolicLink()) continue;
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await filesIn(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const files = (await Promise.all(['apps', 'packages', 'prototypes', 'scripts', 'docs', '.github'].map(filesIn))).flat();
const inputs = [...new Set(['package.json', 'bun.lock', 'README.md', 'AGENTS.md', '.gitignore', ...files])].sort();
const outputPath = resolve(root, reportPath);
if (inputs.some(path => resolve(root, path) === outputPath)) {
  console.error('The verification report cannot overwrite a source input. Use artifacts/verification/.');
  process.exit(2);
}
async function sourceSnapshot(paths) {
  const digest = createHash('sha256');
  const fileDigests = {};
  for (const path of paths) {
    const content = await readFile(resolve(root, path));
    fileDigests[path] = createHash('sha256').update(content).digest('hex');
    digest.update(path).update('\0').update(fileDigests[path]).update('\n');
  }
  return { digest: digest.digest('hex'), file_digests: fileDigests };
}

let previous;
try { previous = JSON.parse(await readFile(outputPath, 'utf8')); } catch {}
const map = JSON.parse(await readFile(resolve(root, 'docs/architecture/repository-map.json'), 'utf8'));
const ontology = JSON.parse(await readFile(resolve(root, map.business_model), 'utf8'));
const source = await sourceSnapshot(inputs);

const report = {
  schema_version: 1,
  started_at: new Date().toISOString(),
  runtime: process.version,
  source: { algorithm: 'sha256', ...source, files: inputs },
  context_review: reviewContext(map, ontology, source.file_digests, previous?.source?.file_digests),
  checks: [],
  limitations: ['The reference kernel uses memory. API integration tests separately exercise Worker storage and authorization; live Claude and native interaction evidence remain separate.', 'Visual and keyboard browser review is separate from this gate.'],
};

function run(commandArgs, input) {
  const result = spawnSync(process.execPath, commandArgs, { cwd: root, encoding: 'utf8', input, timeout: 120_000, maxBuffer: 12 * 1024 * 1024 });
  const output = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n').trim();
  if (result.status !== 0) throw new Error(`${[process.execPath, ...commandArgs].join(' ')}\n${output || `Exit ${result.status}; signal ${result.signal}`}`);
  return output;
}

async function check(id, fn) {
  const start = performance.now();
  try {
    const output = await fn();
    report.checks.push({ id, status: 'passed', duration_ms: Math.round(performance.now() - start), output });
    console.log(`✓ ${id}`);
    if (verbose && output) console.log(output);
  } catch (error) {
    report.checks.push({ id, status: 'failed', duration_ms: Math.round(performance.now() - start), output: error.message });
    console.error(`✗ ${id}\n${error.message}`);
  }
}

await check('javascript-syntax', async () => {
  const modules = files.filter(path => ['.js', '.mjs'].includes(extname(path)));
  for (const file of modules) run(['--check', file]);
  let inlineCount = 0;
  for (const file of files.filter(path => extname(path) === '.html')) {
    const html = await readFile(resolve(root, file), 'utf8');
    for (const [, attributes, source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (/\bsrc\s*=/i.test(attributes) || !source.trim()) continue;
      const type = attributes.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1];
      if (type && !['module', 'text/javascript', 'application/javascript'].includes(type)) continue;
      try { run([...(type === 'module' ? ['--input-type=module'] : []), '--check'], source); }
      catch (error) { throw new Error(`${file}: inline script ${inlineCount + 1}\n${error.message}`); }
      inlineCount++;
    }
  }
  return `${modules.length} JavaScript files and ${inlineCount} inline scripts parsed.`;
});

await check('prototype-local-links', async () => {
  let count = 0;
  for (const file of files.filter(path => path.startsWith('prototypes/') && extname(path) === '.html')) {
    const html = await readFile(resolve(root, file), 'utf8');
    for (const [, raw] of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(raw)) continue;
      const path = decodeURIComponent(raw.split(/[?#]/)[0]);
      if (!path) continue;
      const target = path === '/' ? resolve(root, 'prototypes/desktop/index.html') : path.startsWith('/') ? resolve(root, `.${path}`) : resolve(root, dirname(file), path);
      if (relative(root, target).startsWith('..')) throw new Error(`${file}: reference escapes the repo: ${raw}`);
      try { if (!(await stat(target)).isFile()) throw new Error('not a file'); }
      catch { throw new Error(`${file}: missing local reference ${raw}`); }
      count++;
    }
  }
  return `${count} local prototype references resolved; remote links were not contacted.`;
});

await check('repository-boundaries', () => run(['scripts/check-boundaries.mjs']));

await check('context-references', () => run(['scripts/context.mjs', '--check']));

await check('domain-ontology', () => run(['packages/domain/validate.mjs']));

await check('behavioral-tests', () => {
  const tests = files.filter(path => /\.test\.(?:js|mjs)$/.test(path));
  if (!tests.some(path => path.startsWith('packages/domain/'))) throw new Error('No domain conformance tests found.');
  return run(['--test', ...tests]);
});

await check('design-token-exports', () => [run(['packages/design-system/build.mjs']), run(['packages/design-system/validate.mjs'])].join('\n'));

await check('api-runtime-and-build', () => run(['scripts/check-app.mjs', 'api']));
await check('desktop-native-build', () => run(['scripts/check-app.mjs', 'desktop']));
await check('website-build', () => run(['scripts/check-app.mjs', 'website']));

await check('source-stability', async () => {
  const currentFiles = (await Promise.all(['apps', 'packages', 'prototypes', 'scripts', 'docs', '.github'].map(filesIn))).flat();
  const currentInputs = [...new Set(['package.json', 'bun.lock', 'README.md', 'AGENTS.md', '.gitignore', ...currentFiles])].sort();
  if (JSON.stringify(currentInputs) !== JSON.stringify(inputs) || (await sourceSnapshot(currentInputs)).digest !== report.source.digest) {
    throw new Error('Source changed during verification. Run the gate again against the final files.');
  }
  return 'Source file list and digest remained unchanged during checks.';
});

report.ok = report.checks.every(item => item.status === 'passed');
report.completed_at = new Date().toISOString();
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
if (report.context_review.status === 'review_suggested') console.log(`Context review: ${report.context_review.changed_files.length} changed inputs. Suggested guides are listed in the report.`);
console.log(`${report.ok ? 'Verified' : 'Verification failed'}. Report: ${relative(root, outputPath)}`);
process.exitCode = report.ok ? 0 : 1;
