const names = [...new Set([...document.querySelectorAll('[data-mark]')].map(slot => slot.dataset.mark))];
await Promise.all(names.map(async name => {
  const response = await fetch(`./${name}.svg`);
  if (!response.ok) throw new Error(`Unable to load ${name}`);
  const markup = await response.text();
  const document = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const source = document.documentElement;
  for (const slot of globalThis.document.querySelectorAll(`[data-mark="${name}"]`)) {
    const mark = source.cloneNode(true);
    mark.removeAttribute('aria-labelledby');
    mark.removeAttribute('role');
    mark.setAttribute('aria-hidden', 'true');
    mark.querySelector('title')?.remove();
    slot.replaceChildren(mark);
  }
}));
for (const button of document.querySelectorAll('button[data-tone]')) {
  button.onclick = () => {
    document.documentElement.dataset.tone = button.dataset.tone;
    for (const option of document.querySelectorAll('button[data-tone]')) option.setAttribute('aria-pressed', String(option === button));
  };
}
