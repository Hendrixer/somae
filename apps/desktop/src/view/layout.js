// Measure at the destination width before changing the native frame. A detached
// copy keeps sizing independent of the current viewport. AppKit can interpolate
// to one destination without the webview repeatedly correcting its own frame.
export function fitCompanion({ main, header, dialog, request }) {
  let timer;
  let last = '';
  let moving = false;
  let presentation;
  const reveal = pending => {
    if (pending !== presentation) return;
    presentation = undefined;
    delete main.dataset.layoutPending;
    pending?.();
  };
  window.addEventListener('somae:layout-start', () => { moving = true; });
  window.addEventListener('somae:layout-settled', () => { moving = false; schedule(); });
  const outerHeight = element => {
    if (!element || element.hidden || getComputedStyle(element).display === 'none') return 0;
    const css = getComputedStyle(element);
    return element.getBoundingClientRect().height + (parseFloat(css.marginTop) || 0) + (parseFloat(css.marginBottom) || 0);
  };
  const naturalHeight = element => {
    if (!element) return 0;
    const css = getComputedStyle(element);
    return [...element.children].reduce((height, child) => height + outerHeight(child), 0) + (parseFloat(css.paddingTop) || 0) + (parseFloat(css.paddingBottom) || 0) + Math.max(0, element.children.length - 1) * (parseFloat(css.rowGap) || 0);
  };
  function measure() {
    const view = main.querySelector('.onboarding') ? 'onboarding' : main.dataset.view || 'inbox';
    const width = Math.max(480, Math.min(['review', 'library'].includes(view) ? 1180 : 680, screen.availWidth || 1180));
    // Image fit uses the display rather than the changing window height.
    document.documentElement.style.setProperty('--review-image-limit', `${Math.max(240, Math.min(560, (screen.availHeight || 900) - 300))}px`);
    const probe = document.createElement('div');
    probe.className = 'app-shell';
    probe.setAttribute('aria-hidden', 'true');
    probe.inert = true;
    Object.assign(probe.style, { position: 'fixed', left: '-20000px', top: '0', width: `${width}px`, height: 'auto', visibility: 'hidden', pointerEvents: 'none' });
    const template = document.createElement('template');
    template.innerHTML = main.outerHTML;
    const copy = template.content.firstElementChild;
    // Radios without a form owner share a group across the whole document.
    // The hidden sizing copy must not clear the person's live selection when
    // it enters that document, or reintroduce its HTML-default selection.
    for (const input of copy.querySelectorAll('input[type="radio"]')) input.removeAttribute('name');
    Object.assign(copy.style, { flex: 'none', height: 'auto', overflow: 'visible' });
    if (view === 'review') {
      // The live canvas fills the viewport and gives the comment list its
      // remaining space. Measuring that filled height feeds the current native
      // frame back into its next destination (including border rounding). A
      // review probe must instead lay out its content without viewport/flex
      // constraints; scrolling belongs only to the real, capped window.
      for (const selector of ['.review-layout', '.canvas', '.review-aside', '.review-body', '.review-dock']) {
        const element = copy.querySelector(selector);
        if (element) Object.assign(element.style, {
          height: 'auto', minHeight: '0', maxHeight: 'none',
          flex: 'none', overflow: 'visible',
        });
      }
      const layout = copy.querySelector('.review-layout');
      if (layout) layout.style.alignItems = 'start';
      // Keep this disclosure bounded without the live rail's dvh cap.
      const context = copy.querySelector('.review-request-context');
      if (context) context.style.maxHeight = '230px';
    }
    const head = header.cloneNode(true);
    probe.append(head, copy);
    // A measurement must not fetch private originals again on every keystroke.
    // Keep only image geometry in the invisible copy.
    const originals = [...main.querySelectorAll('img')];
    const images = [...copy.querySelectorAll('img')];
    images.forEach((img, index) => {
      const source = originals[index];
      img.removeAttribute('src');
      img.removeAttribute('srcset');
      if (source?.naturalWidth && source.naturalHeight) {
        img.width = source.naturalWidth;
        img.height = source.naturalHeight;
      }
    });
    document.body.append(probe);
    images.forEach((img, index) => {
      const source = originals[index];
      if (!source?.naturalWidth || !source.naturalHeight || !(img.id === 'artifact-image' || img.matches('.compare > div > img'))) return;
      const available = (img.closest('.image-stage') ?? img.parentElement).clientWidth;
      const cap = parseFloat(getComputedStyle(img).maxHeight) || Infinity;
      // Percentage-sized SVGs can fill beyond their browser fallback intrinsic
      // size. Preserve that observed sizing policy without loading them again.
      const rendered = source.getBoundingClientRect();
      const intrinsicCap = rendered.width > source.naturalWidth + 1 || rendered.height > source.naturalHeight + 1 ? Infinity : 1;
      const scale = Math.min(intrinsicCap, available / source.naturalWidth, cap / source.naturalHeight);
      // A source-less inline img can shrink to its alt text in Blink. Its
      // measured placeholder must retain the original image's geometry.
      img.style.display = 'inline-block';
      img.style.width = `${source.naturalWidth * scale}px`;
      img.style.height = `${source.naturalHeight * scale}px`;
    });
    let content;
    try {
      if (view === 'review') {
        const top = copy.querySelector('.review-top');
        const topHeight = outerHeight(top) + outerHeight(copy.querySelector(':scope > .offline-banner'));
        const offset = Math.ceil(outerHeight(head) + topHeight + 2);
        // Real toolbar height can differ in the narrow browser adaptation.
        const realOffset = Math.ceil(outerHeight(header) + outerHeight(main.querySelector('.review-top')) + outerHeight(main.querySelector(':scope > .offline-banner')) + 2);
        document.documentElement.style.setProperty('--review-offset', `${realOffset}px`);
        probe.style.setProperty('--review-offset', `${offset}px`);
        const canvas = naturalHeight(copy.querySelector('.canvas'));
        const aside = naturalHeight(copy.querySelector('.review-aside'));
        content = topHeight + (width <= 650 ? canvas + aside : Math.max(canvas, aside));
      } else {
        content = [...copy.children].reduce((height, child) => height + outerHeight(child), 0);
      }
      let height = outerHeight(head) + content + 3;
      if (dialog.open) height = Math.max(height, dialog.scrollHeight + 42);
      height = Math.ceil(Math.max(280, Math.min(1000, height)));
      const value = { view, width, height };
      const signature = JSON.stringify(value);
      const pending = presentation;
      if (signature === last) { reveal(pending); return; }
      last = signature;
      // Reveal the incoming content as the native transition starts, after
      // measurement. It must not finish its entrance in the old narrow frame.
      void request('/api/layout', value).catch(() => { if (last === signature) last = ''; }).finally(() => reveal(pending));
    } finally { probe.remove(); }
  }
  function schedule(present) {
    if (typeof present === 'function') {
      presentation = present;
      main.dataset.layoutPending = '';
    }
    clearTimeout(timer);
    timer = setTimeout(measure, 65);
  }
  // Native frame interpolation changes these rectangles every display frame.
  // Those are presentation changes, not new content to size. Real mutations,
  // images, typing and controls still schedule immediately while moving.
  const resize = new ResizeObserver(() => { if (!moving) schedule(); });
  resize.observe(main);
  resize.observe(header);
  resize.observe(dialog);
  const mutations = new MutationObserver(schedule);
  mutations.observe(main, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['open', 'hidden'] });
  mutations.observe(dialog, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['open', 'hidden'] });
  main.addEventListener('load', schedule, true);
  main.addEventListener('toggle', schedule, true);
  document.addEventListener('input', schedule);
  document.addEventListener('pointerup', schedule);
  document.fonts?.ready.then(schedule);
  schedule();
  return schedule;
}
