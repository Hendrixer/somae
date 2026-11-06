import { test, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('native shell preserves WebKit, handles beacon input, and animates centered canvases', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'somae-beacon-native-'));
  try {
    const clt = '/Library/Developer/CommandLineTools';
    const compiler = existsSync(`${clt}/usr/bin/clang`) ? `${clt}/usr/bin/clang` : '/usr/bin/clang';
    const sdk = existsSync(`${clt}/SDKs/MacOSX.sdk`) ? `${clt}/SDKs/MacOSX.sdk` : undefined;
    const executable = join(directory, 'beacon-regression');
    const compiled = Bun.spawn([compiler, ...(sdk ? ['-isysroot', sdk] : []),
      '-fobjc-arc', '-fblocks', '-std=gnu11', '-Wall', '-Wextra', '-Werror',
      '-mmacosx-version-min=12.0', '-framework', 'Foundation', '-framework', 'AppKit',
      '-framework', 'WebKit', resolve('src/native/beacon.test.m'), '-o', executable],
    { stdout: 'pipe', stderr: 'pipe' });
    const diagnostics = await new Response(compiled.stderr).text();
    expect(await compiled.exited, diagnostics).toBe(0);
    const result = Bun.spawn([executable, resolve('dist/native/shortcut.dylib'), resolve('.')], { stdout: 'pipe', stderr: 'pipe' });
    const [output, errors, exit] = await Promise.all([new Response(result.stdout).text(), new Response(result.stderr).text(), result.exited]);
    expect(exit, errors).toBe(0);
    expect(output).toContain('Beacon native regression passed:');
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 15_000);
