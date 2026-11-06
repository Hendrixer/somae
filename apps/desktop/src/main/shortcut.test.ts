import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { registerSummonShortcut } from './shortcut';

test('macOS reserves the chord across processes and releases it on disposal', async () => {
  const path = resolve('dist/native/shortcut.dylib');
  const attempt = async () => {
    const child = Bun.spawn([process.execPath, '-e', `
      import { registerSummonShortcut } from ${JSON.stringify(import.meta.dir + '/shortcut.ts')};
      const shortcut = registerSummonShortcut(${JSON.stringify(path)}, () => {});
      console.log(JSON.stringify({ registered: shortcut.registered, status: shortcut.status }));
      shortcut.dispose();
    `], { stdout: 'pipe', stderr: 'pipe' });
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    return JSON.parse(output);
  };
  const owner = registerSummonShortcut(path, () => {});
  try {
    expect(owner.registered).toBe(true);
    expect(await attempt()).toEqual({ registered: false, status: -9878 });
  } finally { owner.dispose(); }
  owner.dispose(); // Idempotent shutdown must not access an unloaded library.
  expect(await attempt()).toEqual({ registered: true, status: 0 });
});
