import { messageEndpoints, getMessageAvailability } from './message-model.js';

// Local message and signal fixtures. No agent is contacted or work tracked.
export function createMessageUI({ state, save, go, render, icon, senderIcon, esc, toast, getDevice }) {
  const emptyDraft = () => ({ text: '', endpointId: '', includeContext: false });
  const endpoint = id => messageEndpoints.find(item => item.id === id);
  const availability = target => getMessageAvailability(target, { device: getDevice(), paused: state.paused });
  const location = target => target.host === 'hosted' ? 'Hosted' : target.deviceId === getDevice().id ? 'This Mac' : `Local · ${target.locationLabel}`;
  const heading = (eyebrow, title, copy = '') => `<span class="eyebrow">${eyebrow}</span><h1 class="utility-title" tabindex="-1">${title}</h1>${copy ? `<p class="utility-copy">${copy}</p>` : ''}`;
  let picking = false, busy = false, unavailableOpen = false, lastSent = null;

  function signalFrom(message, id = crypto.randomUUID()) {
    const target = endpoint(message.endpointId);
    return {
      id, agent: target.name, project: 'From your message', type: 'question',
      title: 'How far should I take this?', copy: 'A quick first pass, or a few directions to choose from?',
      hint: 'Choose a first pass or a few directions',
      scope: `${target.host === 'hosted' ? 'Hosted agent' : 'Local to ' + target.locationLabel}. Responding to your message.`,
      context: message.context ? `Context you shared:\n${message.context}` : 'Only your message was shared.',
      originalMessage: message.text,
      suggestions: [{ label: 'A first pass', text: 'Give me a concise first pass.' }, { label: 'A few directions', text: 'Explore a few distinct directions.' }]
    };
  }

  // Preserve the previous experiment's draft and actual signals, not its work ledger.
  state.messageDraft = { ...emptyDraft(), ...(state.messageDraft || state.taskDraft) };
  if (typeof state.messageDraft.text !== 'string') state.messageDraft.text = '';
  if (!endpoint(state.messageDraft.endpointId)) state.messageDraft.endpointId = '';
  state.incomingSignals = Array.isArray(state.incomingSignals) ? state.incomingSignals.filter(signal => signal && typeof signal.id === 'string' && typeof signal.agent === 'string' && typeof signal.originalMessage === 'string') : [];
  for (const legacy of Array.isArray(state.startedTasks) ? state.startedTasks : []) {
    if (!legacy || !endpoint(legacy.endpointId) || typeof legacy.text !== 'string' || (legacy.status !== 'needs-input' && !legacy.response)) continue;
    const id = `reply-${legacy.id}`;
    if (!state.incomingSignals.some(signal => signal.id === id)) state.incomingSignals.push(signalFrom(legacy, id));
  }
  delete state.startedTasks;
  delete state.taskDraft;

  function picker() {
    const ready = messageEndpoints.filter(target => availability(target).allowed);
    const blocked = messageEndpoints.filter(target => !availability(target).allowed);
    const row = target => {
      const access = availability(target);
      const description = access.allowed ? target.host === 'local' ? `Runs here · ${target.project} workspace` : target.description : access.reason;
      return `<button type="button" class="endpoint-option ${access.allowed ? '' : 'unavailable'}" data-endpoint="${target.id}" aria-disabled="${!access.allowed}" aria-describedby="reason-${target.id}">${senderIcon(target.name)}<span class="endpoint-copy"><strong>${target.name}<small>${location(target)}</small></strong><span id="reason-${target.id}">${esc(description)}</span></span><span class="endpoint-state">${access.allowed ? state.messageDraft.endpointId === target.id ? icon('check') : icon('arrow') : esc(access.label)}</span></button>`;
    };
    return `<section class="utility-page agent-picker">${heading('TO', 'Who’s it for?', 'Choose an agent.')}
      <div class="endpoint-group"><h2>Ready here</h2>${ready.map(row).join('') || '<p class="endpoint-empty">No agents can receive a new message from here.</p>'}</div>
      <details class="unavailable-agents" id="unavailable-agents" ${unavailableOpen || !ready.length ? 'open' : ''}><summary>${blocked.length} unavailable destination${blocked.length === 1 ? '' : 's'}</summary>${blocked.map(row).join('')}</details>
      <p class="endpoint-rule">Hosted works across devices. Local stays on its computer.</p>
    </section>`;
  }

  function composer() {
    if (picking) return picker();
    const target = endpoint(state.messageDraft.endpointId);
    const access = availability(target);
    return `<section class="utility-page message-compose">${heading('NEW MESSAGE', 'What’s on your mind?')}
      <form id="new-message-form">
        <label class="sr-only" for="message-text">Your message</label>
        <textarea id="message-text" class="message-text" maxlength="4000" rows="4" placeholder="An idea. A question. Something to make.">${esc(state.messageDraft.text)}</textarea>
        <div class="message-routing"><span class="message-field-label">TO</span><button type="button" id="choose-agent" class="destination" aria-label="${target ? 'Change destination, ' + target.name + ', ' + location(target) : 'Choose an agent'}">${target ? `${senderIcon(target.name)}<span><strong>${target.name}</strong><small>${location(target)}</small></span>` : `<span class="destination-empty">${icon('plus')}</span><span>Choose an agent</span>`}${icon('down')}</button></div>
        ${target?.host === 'local' ? `<p class="message-workspace">Workspace <strong>${esc(target.project)}</strong><span>on ${esc(target.locationLabel)}</span></p>` : ''}
        ${target && !access.allowed ? `<p class="message-warning" role="status">${esc(access.reason)}</p>` : ''}
        <label class="message-context"><input type="checkbox" id="include-message-context" ${state.messageDraft.includeContext ? 'checked' : ''}><span>Include my saved context</span><span class="optional-label">Optional</span></label>
        ${state.messageDraft.includeContext ? `<details class="context-disclosure"><summary>See what will be shared</summary><p>${esc(state.context)}</p></details>` : ''}
        <div class="message-compose-bottom"><span>${target ? target.host === 'hosted' ? 'To your hosted agent.' : `To ${esc(target.name)} on ${esc(target.locationLabel)}.` : 'Your draft stays here until you send.'}</span><button class="action primary" id="send-message" ${!target || !access.allowed || !state.messageDraft.text.trim() ? 'disabled' : ''}><span>Send</span>${icon('arrow')}</button></div>
      </form>
    </section>`;
  }

  function receipt() {
    const target = endpoint(lastSent.endpointId);
    return `<section class="utility-page message-receipt"><div class="receipt-label">${senderIcon(target.name)}<span>${icon('check')} MESSAGE SENT</span></div>
      ${heading('', `Sent to ${target.name}.`, 'You can get back to your day. Signals will find you here.')}
      <div class="sent-message"><p>${esc(lastSent.text)}</p></div>
      <div class="message-shared"><span>${target.host === 'hosted' ? 'Hosted' : 'Local · ' + esc(target.locationLabel)}</span><span>${lastSent.context ? 'Saved context included' : 'Only your message was shared'}</span></div>
      ${lastSent.context ? `<details class="context-disclosure"><summary>Included context</summary><p>${esc(lastSent.context)}</p></details>` : ''}
      <button class="action primary message-away" id="message-away">Back to my day ${icon('arrow')}</button>
    </section>`;
  }

  function bind(mode) {
    if (mode !== 'new') return;
    busy = false;
    const unavailable = document.querySelector('#unavailable-agents');
    if (unavailable) unavailable.ontoggle = () => { unavailableOpen = unavailable.open; };
    const choose = document.querySelector('#choose-agent');
    if (choose) choose.onclick = () => { picking = true; render(); };
    document.querySelectorAll('[data-endpoint]').forEach(button => button.onclick = () => {
      const target = endpoint(button.dataset.endpoint);
      if (!availability(target).allowed) return;
      state.messageDraft.endpointId = target.id;
      picking = false;
      save(); render();
    });
    const input = document.querySelector('#message-text');
    if (input) input.oninput = () => {
      state.messageDraft.text = input.value;
      save();
      document.querySelector('#send-message').disabled = !input.value.trim() || !availability(endpoint(state.messageDraft.endpointId)).allowed;
      document.querySelector('#message-draft-status').textContent = input.value.trim() ? 'Draft saved' : '⌘ ↵ to send';
      document.querySelector('#new-message-label').textContent = input.value.trim() ? 'Draft' : 'New';
    };
    const context = document.querySelector('#include-message-context');
    if (context) context.onchange = () => {
      state.messageDraft.includeContext = context.checked;
      save(); render({ focus: false });
      document.querySelector('#include-message-context').focus({ preventScroll: true });
    };
    const form = document.querySelector('#new-message-form');
    if (form) form.onsubmit = event => {
      event.preventDefault();
      if (busy) return;
      const target = endpoint(state.messageDraft.endpointId);
      const access = availability(target);
      const text = state.messageDraft.text.trim();
      if (!access.allowed || !text) { if (target && !access.allowed) toast(access.reason); return; }
      busy = true;
      document.querySelector('#send-message').disabled = true;
      lastSent = { endpointId: target.id, text, context: state.messageDraft.includeContext ? state.context : '' };
      state.messageDraft = { ...emptyDraft(), endpointId: target.id };
      save(); go('sent');
    };
  }

  return {
    view: mode => mode === 'new' ? composer() : receipt(),
    bind,
    hasReceipt: () => Boolean(lastSent),
    isPicking: () => picking,
    leavePicker() { if (!picking) return false; picking = false; render(); return true; },
    focus() { if (!picking) document.querySelector('#message-text')?.focus({ preventScroll: true }); else document.querySelector('#view h1')?.focus({ preventScroll: true }); },
    reset() { state.incomingSignals = []; state.messageDraft = emptyDraft(); lastSent = null; picking = false; busy = false; unavailableOpen = false; },
    signals: () => state.incomingSignals,
    simulateSignal() {
      if (!lastSent) return;
      if (!lastSent.signalId) {
        const signal = signalFrom(lastSent);
        state.incomingSignals.push(signal);
        lastSent.signalId = signal.id;
        save();
      }
      go(`moment/${lastSent.signalId}`);
    }
  };
}
