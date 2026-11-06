// Native form values stay in <select>; the presentation is the same matte control
// in WebKit and in the browser. Open controls own their keyboard until dismissed.
let opened = null;
let sequence = 0;
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export const controlsOpen = () => !!opened;

export function closeControls({ restore = false } = {}) {
  if (!opened) return;
  const previous = opened;
  opened = null;
  if (previous.popup.matches(':popover-open')) previous.popup.hidePopover();
  previous.popup.hidden = true;
  previous.trigger.setAttribute('aria-expanded', 'false');
  previous.root.classList.remove('is-open');
  if (restore && previous.trigger.isConnected) previous.trigger.focus({ preventScroll: true });
}

function positionPopup(control) {
  const rect = control.trigger.getBoundingClientRect();
  const popup = control.popup;
  const width = Math.min(Math.max(rect.width, control.kind === 'select' ? 220 : 210), window.innerWidth - 24);
  popup.style.width = `${width}px`;
  const roomBelow = window.innerHeight - rect.bottom - 18;
  const roomAbove = rect.top - 18;
  const above = roomBelow < Math.min(popup.scrollHeight, 180) && roomAbove > roomBelow;
  popup.style.maxHeight = `${Math.max(80, Math.min(320, above ? roomAbove : roomBelow))}px`;
  popup.style.left = `${Math.max(12, Math.min(control.kind === 'menu' ? rect.right - width : rect.left, window.innerWidth - width - 12))}px`;
  popup.style.top = above ? 'auto' : `${rect.bottom + 7}px`;
  popup.style.bottom = above ? `${window.innerHeight - rect.top + 7}px` : 'auto';
}

function focusOption(index) {
  if (!opened?.items.length) return;
  opened.index = (index + opened.items.length) % opened.items.length;
  opened.items.forEach((item, i) => { item.tabIndex = i === opened.index ? 0 : -1; });
  opened.items[opened.index].focus({ preventScroll: true });
  // Scroll only the popover. Scrolling the focused option's ancestors can
  // move the review rail and dismiss the menu that was just opened.
  const item = opened.items[opened.index].getBoundingClientRect();
  const popup = opened.popup.getBoundingClientRect();
  if (item.top < popup.top + 6) opened.popup.scrollTop -= popup.top + 6 - item.top;
  else if (item.bottom > popup.bottom - 6) opened.popup.scrollTop += item.bottom - popup.bottom + 6;
}

function openControl(control, last = false) {
  if (control.trigger.disabled) return;
  if (opened === control) { closeControls({ restore: true }); return; }
  closeControls();
  opened = control;
  control.items = [...control.popup.querySelectorAll('[role="option"], [role="menuitem"]')].filter(item => !item.disabled);
  control.popup.hidden = false;
  control.root.classList.add('is-open');
  control.trigger.setAttribute('aria-expanded', 'true');
  if (typeof control.popup.showPopover === 'function') control.popup.showPopover();
  positionPopup(control);
  const selected = control.items.findIndex(item => item.getAttribute('aria-selected') === 'true');
  focusOption(last ? control.items.length - 1 : Math.max(0, selected));
}

export function enhanceControls(scope = document) {
  for (const select of scope.querySelectorAll('select:not([data-enhanced])')) {
    const id = select.id || `select-${++sequence}`;
    const label = select.getAttribute('aria-label') || select.closest('label')?.firstChild?.textContent?.trim() || 'Choose an option';
    const root = document.createElement('div');
    root.className = 'select-control';
    root.innerHTML = `<button type="button" class="select-trigger" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="${esc(id)}-options" aria-label="${esc(label)}" ${select.disabled ? 'disabled' : ''}><span class="select-value"></span><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m6 8 4 4 4-4"/></svg></button><div class="select-popover" role="listbox" aria-label="${esc(label)}" id="${esc(id)}-options" popover="manual" hidden></div>`;
    select.before(root);
    root.append(select);
    select.dataset.enhanced = 'true';
    select.hidden = true;
    const trigger = root.querySelector('.select-trigger');
    const popup = root.querySelector('.select-popover');
    const sync = () => {
      const value = select.selectedOptions[0]?.textContent || 'Choose…';
      root.querySelector('.select-value').textContent = value;
      trigger.setAttribute('aria-label', `${label}: ${value}`);
      popup.innerHTML = [...select.options].map((option, i) => `<button type="button" role="option" aria-selected="${option.selected}" class="select-option" data-option-index="${i}" tabindex="-1"${option.disabled ? ' disabled' : ''}><span>${esc(option.textContent)}</span><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m4 10 4 4 8-8"/></svg></button>`).join('');
    };
    sync();
    const control = { kind: 'select', root, trigger, popup, items: [], index: 0 };
    trigger.addEventListener('click', () => openControl(control));
    trigger.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault(); event.stopPropagation(); openControl(control, event.key === 'ArrowUp');
      }
    });
    popup.addEventListener('click', event => {
      const option = event.target.closest('[data-option-index]');
      if (!option || option.disabled) return;
      select.selectedIndex = Number(option.dataset.optionIndex);
      closeControls({ restore: true });
      sync();
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  for (const trigger of scope.querySelectorAll('[data-menu]:not([data-enhanced])')) {
    const root = trigger.closest('.app-menu');
    const popup = root?.querySelector('[role="menu"]');
    if (!popup) continue;
    trigger.dataset.enhanced = 'true';
    popup.setAttribute('popover', 'manual');
    const control = { kind: 'menu', root, trigger, popup, items: [], index: 0 };
    trigger.addEventListener('click', () => openControl(control));
    trigger.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); openControl(control, event.key === 'ArrowUp'); }
    });
    popup.addEventListener('click', event => { if (event.target.closest('[role="menuitem"]')) closeControls(); });
  }
}

document.addEventListener('keydown', event => {
  if (!opened) return;
  if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeControls({ restore: true }); return; }
  if (event.key === 'Tab') { closeControls({ restore: true }); return; }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault(); event.stopImmediatePropagation();
    focusOption(event.key === 'Home' ? 0 : event.key === 'End' ? opened.items.length - 1 : opened.index + (event.key === 'ArrowDown' ? 1 : -1));
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopImmediatePropagation(); opened.items[opened.index]?.click(); return; }
  if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault(); event.stopImmediatePropagation();
    const match = opened.items.findIndex((item, i) => i > opened.index && item.textContent.trim().toLowerCase().startsWith(event.key.toLowerCase()));
    const fallback = opened.items.findIndex(item => item.textContent.trim().toLowerCase().startsWith(event.key.toLowerCase()));
    if (match >= 0 || fallback >= 0) focusOption(match >= 0 ? match : fallback);
    return;
  }
  // Application shortcuts never act on a signal behind an open menu.
  event.stopImmediatePropagation();
}, true);
document.addEventListener('pointerdown', event => { if (opened && !opened.root.contains(event.target)) closeControls(); }, true);
window.addEventListener('resize', () => { if (opened) positionPopup(opened); });
document.addEventListener('scroll', event => { if (opened && !opened.popup.contains(event.target)) closeControls(); }, true);
