import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const app = process.argv[2];
if (!['api', 'desktop', 'website'].includes(app)) throw new Error('Choose api, desktop or website.');
const cwd = fileURLToPath(new URL(`../apps/${app}/`, import.meta.url));
// Run the standard scripts an app defines. The website only defines build; its tests run with the root behavioral tests.
const defined = JSON.parse(readFileSync(`${cwd}package.json`, 'utf8')).scripts ?? {};
for (const script of ['test', 'typecheck', 'build'].filter(name => defined[name])) {
  const run = spawnSync(process.env.SOMAE_BUN ?? 'bun', ['run', script], { cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  if (run.status !== 0) { console.error(run.stdout, run.stderr, run.error?.message ?? ''); process.exit(run.status ?? 1); }
  console.log(`${app} ${script} passed.`);
}
