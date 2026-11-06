// A separate design preference: changing the mark never rerenders Signal's content.
const storageKey = 'somae-signal-mark';
const options = { wave: 'Wave', hello: 'Hello' };
const select = document.querySelector('#preview-mark');
const opener = document.querySelector('#open-brand-preview');
const dialog = document.querySelector('#brand-preview');
const templates = new Map();

const isMark = value => Object.hasOwn(options, value);
let savedMark;
try { savedMark = localStorage.getItem(storageKey); } catch { /* Preview still works without storage. */ }
const queryMark = new URL(location.href).searchParams.get('mark');
let selected = isMark(queryMark) ? queryMark : isMark(savedMark) ? savedMark : 'wave';

function applyMark(name, updateURL = false) {
  if (!templates.has(name)) return;
  selected = name;
  for (const slot of document.querySelectorAll('.signal-mark, [data-brand-mark]')) {
    slot.replaceChildren(templates.get(name).cloneNode(true));
  }
  document.documentElement.dataset.brand = name;
  select.value = name;
  document.querySelector('#brand-preview-title').textContent = `${options[name]}. At every size.`;
  const download = document.querySelector('#brand-download');
  download.href = `/prototypes/marks/${name}-refined.svg`;
  download.download = `somae-${name}.svg`;
  for (const button of document.querySelectorAll('[data-brand-choice]')) {
    button.setAttribute('aria-pressed', String(button.dataset.brandChoice === name));
  }
  try { localStorage.setItem(storageKey, name); } catch { /* Optional preference. */ }
  if (updateURL) {
    const url = new URL(location.href);
    url.searchParams.set('mark', name);
    history.replaceState(null, '', url);
  }
}

try {
  await Promise.all(Object.keys(options).map(async name => {
    const response = await fetch(`/prototypes/marks/${name}-refined.svg`);
    if (!response.ok) throw new Error(`Unable to load ${name} mark`);
    const svg = new DOMParser().parseFromString(await response.text(), 'image/svg+xml').documentElement;
    if (svg.localName !== 'svg' || svg.querySelector('parsererror')) throw new Error(`Invalid ${name} mark`);
    svg.querySelector('title')?.remove();
    svg.removeAttribute('aria-labelledby');
    svg.removeAttribute('role');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    templates.set(name, svg);
  }));
  applyMark(selected);
  select.disabled = false;
  opener.disabled = false;
} catch (error) {
  // The original signal bars remain available if a local design asset cannot load.
  console.warn('Logo preview unavailable:', error);
  opener.textContent = 'Marks unavailable';
}

select.addEventListener('change', () => applyMark(select.value, true));
for (const button of document.querySelectorAll('[data-brand-choice]')) {
  button.addEventListener('click', () => applyMark(button.dataset.brandChoice, true));
}
opener.addEventListener('click', () => dialog.showModal());
document.querySelector('#close-brand-preview').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => opener.focus({ preventScroll: true }));
