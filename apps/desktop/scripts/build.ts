import { mkdir, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildShortcut } from './native';

const mode = process.argv[2] ?? 'build';
if (!['build', 'dev', 'assets'].includes(mode)) throw new Error('Choose build, dev or assets.');
await mkdir('dist/view', { recursive: true });
await cp('src/view', 'dist/view', { recursive: true });
await cp('../../packages/design-system/dist/tokens.css', 'dist/view/tokens.css');
await cp('../../packages/design-system/assets/wave.svg', 'dist/view/wave.svg');
await cp('../../prototypes/signal/assets/claude.svg', 'dist/view/claude.svg');
const signalContent = await Bun.build({ entrypoints: ['src/view/signal-content.js'], target: 'browser', format: 'esm', outdir: 'dist/view', naming: 'signal-content.js', minify: false });
if (!signalContent.success) throw new Error(signalContent.logs.map(String).join('\n'));
const bundle = await Bun.build({ entrypoints: ['../../packages/claude-channel/src/remote.ts'], target: 'bun', outdir: 'dist', naming: 'bridge.js', minify: false });
if (!bundle.success) throw new Error(bundle.logs.map(String).join('\n'));
await buildShortcut();
if (mode !== 'assets') {
  const process = Bun.spawn(['electrobun', mode, ...(mode === 'build' ? ['--env=dev'] : [])], { cwd: resolve('.'), stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' });
  globalThis.process.exitCode = await process.exited;
}
