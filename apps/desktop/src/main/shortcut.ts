import { dlopen, FFIType } from 'bun:ffi';

export function registerSummonShortcut(path: string, summon: () => void) {
  const native = dlopen(path, {
    somae_hotkey_start: { args: [], returns: FFIType.i32 },
    somae_hotkey_take: { args: [], returns: FFIType.u32 },
    somae_hotkey_stop: { args: [], returns: FFIType.i32 },
  });
  const status = native.symbols.somae_hotkey_start();
  if (status !== 0) {
    native.close();
    return { registered: false, status, dispose() {} };
  }
  const poll = setInterval(() => {
    const count = native.symbols.somae_hotkey_take();
    for (let i = 0; i < count; i++) summon();
  }, 25);
  let disposed = false;
  return { registered: true, status, dispose() {
    if (disposed) return;
    disposed = true;
    clearInterval(poll);
    native.symbols.somae_hotkey_stop();
    native.close();
  } };
}
