import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { flatten, resolvedRecords, generate, root } from './build.mjs';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const supported = new Set(['color', 'dimension', 'duration', 'fontFamily', 'fontWeight', 'number', 'cubicBezier', 'shadow']);
const requiredRoles = ['stage', 'stageInk', 'panel', 'surface', 'surfaceHover', 'line', 'ink', 'muted', 'faint', 'accent', 'accentInk', 'accentDim', 'focus', 'selection', 'annotation', 'annotationFill'];
const luminance = value => value.components.map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
const contrast = (foreground, background) => {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
};
function requireValue(condition, message) { assert.ok(condition, message); }
function dimension(value, path, units = ['px', 'rem']) {
  requireValue(value && typeof value === 'object' && finite(value.value) && units.includes(value.unit), `${path}: expected dimension in ${units.join('/')}`);
}
function color(value, path) {
  requireValue(value && value.colorSpace === 'srgb', `${path}: this exporter supports sRGB colors`);
  requireValue(Array.isArray(value.components) && value.components.length === 3 && value.components.every(component => finite(component) && component >= 0 && component <= 1), `${path}: invalid sRGB components`);
  requireValue(value.alpha === undefined || finite(value.alpha) && value.alpha >= 0 && value.alpha <= 1, `${path}: alpha must be in [0,1]`);
  if (value.hex !== undefined) {
    requireValue(/^#[\da-fA-F]{6}$/.test(value.hex), `${path}: invalid fallback hex`);
    value.components.forEach((component, index) => requireValue(Math.round(component * 255) === parseInt(value.hex.slice(1 + index * 2, 3 + index * 2), 16), `${path}: hex fallback disagrees with components`));
  }
}
function shadow(value, path) {
  color(value.color, `${path}.color`);
  for (const field of ['offsetX', 'offsetY', 'blur', 'spread']) dimension(value[field], `${path}.${field}`);
  requireValue(value.blur.value >= 0, `${path}: shadow blur must be nonnegative`);
  requireValue(value.inset === undefined || typeof value.inset === 'boolean', `${path}: inset must be boolean`);
}
export function validateDocument(document) {
  const metadata = document.$extensions?.['com.somae'];
  requireValue(metadata && metadata.brand === 'Wave' && metadata.version, 'Brand and version metadata are required');
  requireValue(metadata.reducedMotion?.includes('prefers-reduced-motion'), 'Reduced-motion policy is required');
  const themeNames = Object.keys(metadata.themes ?? {});
  requireValue(themeNames.includes(metadata.defaultTheme), 'Default theme must exist');
  requireValue(themeNames.length === 3, 'This release documents three material themes');
  const raw = flatten(document);
  requireValue(raw.length > 0, 'No tokens found');
  const resolved = resolvedRecords(document);
  for (const record of resolved) {
    const { path, type, value, description } = record;
    requireValue(supported.has(type), `${path}: unsupported or missing token type ${type}`);
    requireValue(typeof description === 'string' && description.trim().length > 8, `${path}: descriptive usage guidance is required`);
    switch (type) {
      case 'color': color(value, path); break;
      case 'dimension': dimension(value, path); break;
      case 'duration': dimension(value, path, ['ms', 's']); requireValue(value.value >= 0, `${path}: negative duration`); break;
      case 'fontFamily': requireValue((typeof value === 'string' && value.length > 0) || Array.isArray(value) && value.length > 0 && value.every(family => typeof family === 'string' && family.length > 0), `${path}: invalid font stack`); break;
      case 'fontWeight': requireValue(finite(value) && value >= 1 && value <= 1000, `${path}: expected numeric font weight in [1,1000]`); break;
      case 'number': requireValue(finite(value), `${path}: expected finite number`); break;
      case 'cubicBezier': requireValue(Array.isArray(value) && value.length === 4 && value.every(finite) && value[0] >= 0 && value[0] <= 1 && value[2] >= 0 && value[2] <= 1, `${path}: invalid easing curve`); break;
      case 'shadow': (Array.isArray(value) ? value : [value]).forEach((item, index) => shadow(item, `${path}[${index}]`)); break;
    }
  }
  for (const theme of themeNames) {
    const roles = Object.keys(document.color?.[theme] ?? {}).filter(key => !key.startsWith('$'));
    assert.deepEqual(roles.slice().sort(), requiredRoles.slice().sort(), `${theme}: semantic theme roles must be identical`);
    for (const role of roles) {
      const record = resolved.find(token => token.path === `color.${theme}.${role}`);
      requireValue(record?.type === 'color', `${theme}.${role}: semantic theme roles must have color type`);
    }
    const values = Object.fromEntries(resolved.filter(record => record.path.startsWith(`color.${theme}.`)).map(record => [record.path.split('.').at(-1), record.value]));
    for (const role of ['panel', 'surface', 'surfaceHover', 'line']) {
      const channels = values[role].components;
      requireValue(channels.every(channel => channel === channels[0]), `${theme}.${role}: material surfaces must stay neutral`);
    }
    requireValue(values.panel.components[0] <= 16 / 255, `${theme}.panel: material must stay near black`);
    for (const background of ['panel', 'surface', 'surfaceHover', 'selection']) {
      for (const foreground of ['ink', 'muted', 'faint']) requireValue(contrast(values[foreground], values[background]) >= 4.5, `${theme}.${foreground}: text contrast on ${background} must be at least 4.5:1`);
      requireValue(contrast(values.focus, values[background]) >= 3, `${theme}.focus: indicator contrast on ${background} must be at least 3:1`);
    }
    requireValue(contrast(values.accentInk, values.accent) >= 4.5, `${theme}.accentInk: primary action text must have at least 4.5:1 contrast`);
    requireValue(values.annotationFill.alpha > 0 && values.annotationFill.alpha <= .1, `${theme}.annotationFill: keep the artifact visible beneath the fill`);
    requireValue(metadata.themes[theme].status === (theme === 'electric' ? 'current' : 'experimental'), `${theme}: incorrect maturity status`);
  }
  const records = generate(document).records;
  const seen = new Set();
  for (const token of records) {
    const identity = `${token.theme || 'common'}:${token.cssVariable}`;
    requireValue(!seen.has(identity), `CSS variable collision: ${identity}`);
    seen.add(identity);
  }
  return resolved.length;
}

async function validate() {
  const document = JSON.parse(await readFile(join(root, 'tokens.json'), 'utf8'));
  const count = validateDocument(document);
  const generated = generate(document);
  for (const [file, expected] of Object.entries(generated.files)) {
    assert.equal(await readFile(join(root, 'dist', file), 'utf8'), expected, `${file} has drifted from tokens.json; rebuild it`);
  }
  for (const file of ['agent-guide.md', 'llms.txt']) {
    assert.equal(await readFile(join(root, 'dist', file), 'utf8'), await readFile(join(root, file), 'utf8'), `${file}: copied guide has drifted`);
  }
  const module = await import(pathToFileURL(join(root, 'dist', 'tokens.js')).href + `?validation=${Date.now()}`);
  assert.deepEqual(module.tokens, generated.tokens, 'JS tokens must match canonical conversions');
  assert.deepEqual(module.themes, generated.themes, 'JS themes must match canonical colors');
  assert.throws(() => module.cssVariables('unknown'), RangeError, 'Unknown theme must not silently fall back');
  for (const theme of Object.keys(generated.themes)) {
    const expected = Object.fromEntries(generated.records.filter(token => !token.theme || token.theme === theme).map(token => [token.cssVariable, token.cssValue]));
    assert.deepEqual(module.cssVariables(theme), expected, `${theme}: CSS-variable map is incomplete`);
  }
  // Prove the checks reject malformed input instead of merely accepting today's file.
  const negativeDuration = structuredClone(document);
  negativeDuration.motion.duration.summon.$value.value = -1;
  assert.throws(() => validateDocument(negativeDuration), /negative duration/);
  const unequalTheme = structuredClone(document);
  delete unequalTheme.color.infrared.accent;
  assert.throws(() => validateDocument(unequalTheme), /semantic theme roles/);
  const tintedPanel = structuredClone(document);
  tintedPanel.color.electric.panel.$value = { colorSpace: 'srgb', components: [12 / 255, 12 / 255, 16 / 255], alpha: 1 };
  assert.throws(() => validateDocument(tintedPanel), /surfaces must stay neutral/);
  const invisibleFocus = structuredClone(document);
  invisibleFocus.color.electric.focus.$value = structuredClone(document.color.electric.line.$value);
  assert.throws(() => validateDocument(invisibleFocus), /indicator contrast/);
  const opaqueAnnotation = structuredClone(document);
  opaqueAnnotation.color.electric.annotationFill.$value.alpha = .5;
  assert.throws(() => validateDocument(opaqueAnnotation), /artifact visible/);
  const nonColorRole = structuredClone(document);
  nonColorRole.color.electric.panel.$type = 'number';
  nonColorRole.color.electric.panel.$value = 1;
  assert.throws(() => validateDocument(nonColorRole), /semantic theme roles must have color type/);
  const badHex = structuredClone(document);
  badHex.color.electric.accent.$value.hex = '#000000';
  assert.throws(() => validateDocument(badHex), /disagrees/);
  const missingAlias = structuredClone(document);
  missingAlias.radius.action.$value = '{radius.missing}';
  assert.throws(() => validateDocument(missingAlias), /Unknown alias/);
  const circularAlias = structuredClone(document);
  circularAlias.radius.action.$value = '{radius.panel}';
  circularAlias.radius.panel.$value = '{radius.action}';
  assert.throws(() => validateDocument(circularAlias), /Circular token alias/);
  const typedAlias = structuredClone(document);
  typedAlias.radius.action.$value = '{color.electric.panel}';
  assert.throws(() => validateDocument(typedAlias), /Alias type mismatch/);
  const validAlias = structuredClone(document);
  validAlias.radius.action.$value = '{radius.panel}';
  assert.equal(generate(validAlias).tokens.radius.action, '15px', 'Valid alias should resolve');
  const files = await readdir(join(root, 'dist'));
  requireValue(!files.some(file => file.startsWith('.') || ['src', 'build.mjs', 'validate.mjs', 'node_modules'].includes(file)), 'Build must publish only static content and public artifacts');
  console.log(`Validated ${count} tokens: types, neutral materials, text/focus contrast, restrained annotation fill, theme parity, aliases, exact generated exports, and rejection cases.`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await validate();
