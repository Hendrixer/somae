import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function buildShortcut() {
  if (process.platform !== 'darwin') throw new Error('The first Somae desktop test requires macOS.');
  // Prefer a standalone CLT installation when Xcode is selected but not set up.
  const clt = '/Library/Developer/CommandLineTools';
  const compiler = existsSync(`${clt}/usr/bin/clang`) ? `${clt}/usr/bin/clang` : '/usr/bin/clang';
  const sdk = existsSync(`${clt}/SDKs/MacOSX.sdk`) ? `${clt}/SDKs/MacOSX.sdk` : undefined;
  await mkdir('dist/native', { recursive: true });
  const compile = Bun.spawn([compiler, ...(sdk ? ['-isysroot', sdk] : []), '-dynamiclib', '-fobjc-arc', '-fblocks', '-std=gnu11', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter', '-mmacosx-version-min=12.0', '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'QuartzCore', '-framework', 'Carbon', '-framework', 'UserNotifications', resolve('src/native/shortcut.m'), resolve('src/native/notifications.m'), '-o', resolve('dist/native/shortcut.dylib')], { stdout: 'inherit', stderr: 'inherit' });
  if (await compile.exited !== 0) throw new Error('Could not compile the macOS shortcut bridge. Install/configure Apple Command Line Tools.');
}

if (import.meta.main) await buildShortcut();
