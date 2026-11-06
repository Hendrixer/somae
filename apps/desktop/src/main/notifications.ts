import { dlopen, FFIType, ptr } from 'bun:ffi';

export type NotificationPermission = 'unavailable' | 'not_determined' | 'denied' | 'allowed' | 'requesting' | 'error';
const permissions: Record<number, NotificationPermission> = { '-3': 'error', '-2': 'requesting', '-1': 'unavailable', 0: 'not_determined', 1: 'denied', 2: 'allowed', 3: 'allowed' };

/** The native delegate owns OS callbacks; Bun only consumes bounded state. */
export function createNativeNotifications(path: string, onOpen: (id: string) => void) {
  const native = dlopen(path, {
    somae_notifications_start: { args: [], returns: FFIType.i32 },
    somae_notifications_status: { args: [], returns: FFIType.i32 },
    somae_notifications_request: { args: [], returns: FFIType.i32 },
    somae_notifications_post: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    somae_notifications_take: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    somae_notifications_visible: { args: [FFIType.i32], returns: FFIType.void },
  });
  native.symbols.somae_notifications_start(); // Reads settings; never requests permission.
  let disposed = false;
  const status = () => permissions[native.symbols.somae_notifications_status()] ?? 'error';
  const poll = setInterval(() => {
    if (disposed) return;
    const buffer = new Uint8Array(1024);
    const length = native.symbols.somae_notifications_take(ptr(buffer), buffer.length);
    if (length > 0) onOpen(new TextDecoder().decode(buffer.subarray(0, length)));
  }, 250);
  const cstring = (value: string) => new TextEncoder().encode(`${value}\0`);
  return {
    status,
    request() { native.symbols.somae_notifications_request(); return status(); },
    setVisible(visible: boolean) { native.symbols.somae_notifications_visible(visible ? 1 : 0); },
    post(signal: { id: string; sender: string; title: string }) {
      if (disposed || status() !== 'allowed') return false;
      const id = cstring(signal.id), title = cstring(signal.sender), body = cstring(signal.title);
      return native.symbols.somae_notifications_post(ptr(id), ptr(title), ptr(body)) === 0;
    },
    dispose() { disposed = true; clearInterval(poll); },
  };
}
