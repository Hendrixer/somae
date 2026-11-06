import { dlopen, FFIType, ptr, type Pointer } from 'bun:ffi';
import { tokens } from '../../../../packages/design-system/dist/tokens.js';

/** Style only our owned BrowserWindow. No native pointer crosses the UI host. */
export function styleCompanionWindow(path: string, pointer: Pointer | null, options: {
  kind?: 'main' | 'settings' | 'beacon';
  radius?: number;
  minimumWidth?: number;
  minimumHeight?: number;
  isVisible?: () => boolean;
  onOpen?: () => void;
  onHover?: (hovered: boolean) => void;
} = {}) {
  if (!pointer) throw new Error('Somae could not access its native window.');
  const native = dlopen(path, {
    somae_window_style: {
      args: [FFIType.ptr, FFIType.f64, FFIType.f64, FFIType.f64],
      returns: FFIType.i32,
    },
    somae_window_resize: {
      args: [FFIType.ptr, FFIType.f64, FFIType.f64, FFIType.i32, FFIType.i32],
      returns: FFIType.i32,
    },
    somae_window_motion_state: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    somae_window_motion_active: { args: [FFIType.ptr], returns: FFIType.i32 },
    somae_window_motion_configure: {
      args: [FFIType.ptr, FFIType.f64, FFIType.f64, FFIType.f64, FFIType.f64, FFIType.f64],
      returns: FFIType.i32,
    },
    somae_window_beacon_style: { args: [FFIType.ptr], returns: FFIType.i32 },
    somae_window_place_beacon: { args: [FFIType.ptr], returns: FFIType.i32 },
    somae_window_is_key: { args: [FFIType.ptr], returns: FFIType.i32 },
    somae_app_deactivate: { args: [], returns: FFIType.i32 },
    somae_window_focus_content: { args: [FFIType.ptr], returns: FFIType.i32 },
    somae_beacon_state_take: { args: [], returns: FFIType.u32 },
  });
  // AppKit dimensions are logical points, matching CSS pixels in the system
  // webview at its default page zoom. Reject a future incompatible unit.
  const radius = tokens.radius.panel;
  if (!/^\d+(?:\.\d+)?px$/.test(radius)) {
    native.close();
    throw new Error('The companion window radius must be expressed in pixels.');
  }
  const status = native.symbols.somae_window_style(pointer,
    options.radius ?? Number.parseFloat(radius), options.minimumWidth ?? 480,
    options.minimumHeight ?? 260);
  if (status !== 0) {
    native.close();
    throw new Error(`Somae could not style its native window (macOS ${status}).`);
  }
  const durationToken = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(tokens.motion.duration.resize.trim());
  const duration = durationToken ? Number(durationToken[1]) / (durationToken[2] === 'ms' ? 1000 : 1) : NaN;
  const easingToken = /^cubic-bezier\(([^)]+)\)$/.exec(tokens.motion.easing.standard.trim());
  const controls = easingToken?.[1].split(',').map(value => value.trim() ? Number(value) : NaN) ?? [];
  if (!Number.isFinite(duration) || duration <= 0 || controls.length !== 4 ||
    controls.some(value => !Number.isFinite(value)) || controls[0] < 0 || controls[0] > 1 ||
    controls[2] < 0 || controls[2] > 1) {
    native.close();
    throw new Error('Native window motion needs a positive ms/s duration and a valid cubic-bezier token.');
  }
  const motionStatus = native.symbols.somae_window_motion_configure(pointer, duration,
    controls[0], controls[1], controls[2], controls[3]);
  if (motionStatus !== 0) {
    native.close();
    throw new Error(`Somae could not configure its native window motion (macOS ${motionStatus}).`);
  }
  if (options.kind === 'beacon') {
    const status = native.symbols.somae_window_beacon_style(pointer);
    if (status !== 0) {
      native.close();
      throw new Error(`Somae could not configure its beacon (macOS ${status}).`);
    }
  }
  let disposed = false;
  let hovered = false;
  const beaconPoll = options.kind === 'beacon' ? setInterval(() => {
    if (disposed || (options.isVisible && !options.isVisible())) return;
    const state = native.symbols.somae_beacon_state_take();
    const nextHovered = (state >>> 31) === 1;
    if (nextHovered !== hovered) { hovered = nextHovered; options.onHover?.(hovered); }
    const clicks = state & 0x7fffffff;
    if (clicks) options.onOpen?.();
  }, 50) : undefined;
  return {
    resize(width: number, height: number, expanded = false, animate = true) {
      if (disposed) return;
      const status = native.symbols.somae_window_resize(pointer, width, height, expanded ? 1 : 0, animate ? 1 : 0);
      if (status !== 0) throw new Error(`Somae could not resize its native window (macOS ${status}).`);
    },
    motionState() {
      const values = new Float64Array(14);
      if (!disposed) native.symbols.somae_window_motion_state(pointer, ptr(values));
      return { active: values[0] === 1, starts: values[1], completions: values[2],
        frames: values[3], elapsed_ms: values[4], max_gap_ms: values[5],
        first_frame_ms: values[10], max_progress_gap_ms: values[11],
        max_progress_gap_distance: values[12], max_significant_gap_ms: values[13],
        target: { x: values[6], y: values[7], width: values[8], height: values[9] } };
    },
    motionActive() { return !disposed && native.symbols.somae_window_motion_active(pointer) === 1; },
    placeBeacon() {
      if (disposed) return;
      const status = native.symbols.somae_window_place_beacon(pointer);
      if (status !== 0) throw new Error(`Somae could not place its beacon (macOS ${status}).`);
    },
    isKey() { return !disposed && native.symbols.somae_window_is_key(pointer) === 1; },
    releaseFocus() { if (!disposed) native.symbols.somae_app_deactivate(); },
    focusContent() {
      return !disposed && native.symbols.somae_window_focus_content(pointer) === 0;
    },
    // Keep this image loaded until process exit rather than unloading code
    // that an owned control may still call.
    dispose() { disposed = true; if (beaconPoll) clearInterval(beaconPoll); },
  };
}
