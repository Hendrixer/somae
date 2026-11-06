import { readFile, writeFile, mkdir, readdir, rm, lstat, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = dirname(fileURLToPath(import.meta.url));
const reserved = new Set(['tokens.json', 'tokens.css', 'tokens.js', 'tokens.d.ts', 'catalog.json', 'agent-guide.md', 'llms.txt']);
const kebab = value => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

export function flatten(document) {
  const records = [];
  function visit(node, path = [], type) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error(`Invalid token/group at ${path.join('.')}`);
    type = node.$type ?? type;
    if (Object.hasOwn(node, '$value')) {
      records.push({ path: path.join('.'), type, value: node.$value, description: node.$description, status: node.$extensions?.['com.somae']?.status ?? 'working' });
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('$')) continue;
      if (/[.{}]/.test(key)) throw new Error(`Invalid token name: ${key}`);
      visit(child, [...path, key], type);
    }
  }
  visit(document);
  return records;
}

export function resolvedRecords(document) {
  const raw = flatten(document);
  const index = new Map(raw.map(record => [record.path, record]));
  function resolveValue(value, stack, expectedType) {
    if (typeof value === 'string' && /^\{[^{}]+\}$/.test(value)) {
      const path = value.slice(1, -1);
      const target = index.get(path);
      if (!target) throw new Error(`Unknown alias ${value}`);
      if (stack.includes(path)) throw new Error(`Circular token alias: ${[...stack, path].join(' -> ')}`);
      if (expectedType && target.type !== expectedType) throw new Error(`Alias type mismatch at ${stack.at(-1)}: ${expectedType} -> ${target.type}`);
      return resolveValue(target.value, [...stack, path], target.type);
    }
    if (Array.isArray(value)) return value.map(child => resolveValue(child, stack));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveValue(child, stack)]));
    return value;
  }
  return raw.map(record => ({ ...record, value: resolveValue(record.value, [record.path], record.type) }));
}

function colorCSS(value) {
  const rgb = value.components.map(component => Math.round(component * 255));
  if ((value.alpha ?? 1) === 1) return `#${rgb.map(component => component.toString(16).padStart(2, '0')).join('')}`;
  return `rgb(${rgb.join(' ')} / ${Math.round(value.alpha * 10000) / 100}%)`;
}
const dimensionCSS = value => `${value.value}${value.unit}`;
function shadowCSS(value) {
  return `${value.inset ? 'inset ' : ''}${[value.offsetX, value.offsetY, value.blur, value.spread].map(dimensionCSS).join(' ')} ${colorCSS(value.color)}`;
}
export function cssValue(type, value) {
  switch (type) {
    case 'color': return colorCSS(value);
    case 'dimension': case 'duration': return dimensionCSS(value);
    case 'fontFamily': return (Array.isArray(value) ? value : [value]).map(family => /^(serif|sans-serif|monospace|system-ui|cursive|fantasy|ui-serif|ui-sans-serif|ui-monospace|ui-rounded)$/.test(family) ? family : JSON.stringify(family)).join(', ');
    case 'fontWeight': case 'number': return String(value);
    case 'cubicBezier': return `cubic-bezier(${value.join(', ')})`;
    case 'shadow': return (Array.isArray(value) ? value : [value]).map(shadowCSS).join(', ');
    default: throw new Error(`Unsupported export type ${type}`);
  }
}

function setPath(object, path, value) {
  let target = object;
  const keys = path.split('.');
  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  target[keys.at(-1)] = value;
}
function typeFor(value, indent = 0) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `readonly [${value.map(item => typeFor(item)).join(', ')}]`;
  if (value && typeof value === 'object') return `{\n${Object.entries(value).map(([key, child]) => `${'  '.repeat(indent + 1)}readonly ${JSON.stringify(key)}: ${typeFor(child, indent + 1)};`).join('\n')}\n${'  '.repeat(indent)}}`;
  return String(value);
}

export function generate(document) {
  const metadata = document.$extensions['com.somae'];
  const themeNames = Object.keys(metadata.themes);
  const records = resolvedRecords(document).map(record => {
    const parts = record.path.split('.');
    const theme = parts[0] === 'color' && themeNames.includes(parts[1]) ? parts[1] : null;
    const variableParts = theme ? [parts[0], ...parts.slice(2)] : parts;
    return { ...record, cssValue: cssValue(record.type, record.value), cssVariable: '--somae-' + variableParts.map(kebab).join('-'), theme };
  });
  const tokens = {};
  for (const record of records) setPath(tokens, record.path, record.cssValue);
  const themes = Object.fromEntries(themeNames.map(theme => [theme, tokens.color[theme]]));
  const common = records.filter(record => !record.theme);
  const vars = list => list.map(record => `  ${record.cssVariable}: ${record.cssValue};`).join('\n');
  const css = `/* Generated from tokens.json. Edit the source, then run node build.mjs. */\n:root {\n${vars(common)}\n}\n${themeNames.map(theme => `${theme === metadata.defaultTheme ? ':root,\n' : ''}[data-theme="${theme}"] {\n${vars(records.filter(record => record.theme === theme))}\n}`).join('\n')}\n`;
  const commonVars = Object.fromEntries(common.map(record => [record.cssVariable, record.cssValue]));
  const themeVars = Object.fromEntries(themeNames.map(theme => [theme, Object.fromEntries(records.filter(record => record.theme === theme).map(record => [record.cssVariable, record.cssValue]))]));
  const js = `// Generated from tokens.json. Values are CSS-ready strings, not native platform styles.\nexport const metadata = ${JSON.stringify(metadata, null, 2)};\nexport const tokens = ${JSON.stringify(tokens, null, 2)};\nexport const themes = tokens.color;\nconst common = ${JSON.stringify(commonVars, null, 2)};\nconst themed = ${JSON.stringify(themeVars, null, 2)};\nexport function cssVariables(theme = ${JSON.stringify(metadata.defaultTheme)}) {\n  if (!Object.hasOwn(themed, theme)) throw new RangeError('Unknown Somae theme: ' + theme);\n  return { ...common, ...themed[theme] };\n}\n`;
  const dts = `/** Generated from tokens.json. Token leaves are CSS-ready strings. */\nexport type Theme = ${themeNames.map(JSON.stringify).join(' | ')};\nexport declare const metadata: ${typeFor(metadata)};\nexport declare const tokens: ${typeFor(tokens)};\nexport declare const themes: typeof tokens.color;\nexport declare function cssVariables(theme?: Theme): Record<string, string>;\n`;
  return { metadata, records, tokens, themes, files: { 'tokens.css': css, 'tokens.js': js, 'tokens.d.ts': dts, 'catalog.json': JSON.stringify({ metadata, themes: themeNames, tokens: records }, null, 2) + '\n', 'tokens.json': JSON.stringify(document, null, 2) + '\n' } };
}

async function copyTree(source, destination, top = true) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (top && reserved.has(entry.name)) throw new Error(`Static source collides with generated file ${entry.name}`);
    const from = join(source, entry.name), to = join(destination, entry.name);
    if ((await lstat(from)).isSymbolicLink()) throw new Error(`Refusing to publish symlink ${from}`);
    if (entry.isDirectory()) await copyTree(from, to, false);
    else if (entry.isFile()) await copyFile(from, to);
  }
}

export async function build() {
  const document = JSON.parse(await readFile(join(root, 'tokens.json'), 'utf8'));
  const { validateDocument } = await import('./validate.mjs');
  validateDocument(document);
  const output = generate(document);
  const destination = join(root, 'dist');
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await copyTree(join(root, 'src'), destination);
  await copyTree(join(root, 'assets'), join(destination, 'assets'));
  for (const [name, content] of Object.entries(output.files)) await writeFile(join(destination, name), content);
  for (const name of ['agent-guide.md', 'llms.txt']) await copyFile(join(root, name), join(destination, name));
  console.log(`Built Somae Design ${output.metadata.version}: ${output.records.length} tokens, ${Object.keys(output.themes).length} themes -> dist/`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  build().catch(error => { console.error(error); process.exitCode = 1; });
}
