import { enhanceControls, closeControls, controlsOpen } from './controls.js';
import { initPreferences, reduceMotion } from './preferences.js';
import { fitCompanion } from './layout.js';
import { createImageGesture } from './image-gesture.js';
import { captureReviewRequest, reviewRequestIsCurrent, reviewSourceForSubmission, sameReviewPins } from './review-context.js';
import { annotationForAsset, parkAnnotation, resumeAnnotation, discardAnnotation, prepareAnnotationsForSubmit } from './annotation-drafts.js';
import { signalContent } from './signal-content.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = name => `<svg aria-hidden="true" viewBox="0 0 24 24">${({ inbox: '<path d="M4 5h16v14H4zM4 13h5l2 3h2l2-3h5"/>', library: '<path d="M5 4v16M10 4v16M15 5l5 14"/>', plus: '<path d="M12 5v14M5 12h14"/>', edit: '<path d="m15 4 5 5M4 20l4-1L20 7l-5-5L3 14l-1 6z"/>', left: '<path d="m14 6-6 6 6 6"/>', right: '<path d="m10 6 6 6-6 6"/>', arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>', check: '<path d="m5 12 4 4L19 6"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>', dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>', file: '<path d="M6 3h8l4 4v14H6zM14 3v5h5M9 12h6M9 16h5"/>', down: '<path d="m6 9 6 6 6-6"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4"/>', compare: '<path d="M12 3v18M4 7h4v10H4zM16 7h4v10h-4z"/>', message: '<path d="M4 4h16v13H9l-5 4z"/>', folder: '<path d="M3 6h7l2 3h9v11H3z"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', region: '<path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>' })[name] ?? ''}</svg>`;
const uuid = () => crypto.randomUUID();
let data = { connections: [], conversations: [], signals: [], items: [], messages: [], reviews: [], drafts: {}, deliveries: [], local_sessions: [] };
let state = { tab: 'inbox', index: 0, option: 0, later: false, conversation: null, item: null, revision: null, compare: false, search: '', pastSessions: false, marking: false, activeComment: -1 };
let selected = null;
let displayedSignal = null;
let busy = false;
let signalToOpen;
let modalRestore = null;
let toastTimer;
let draftWrites = Promise.resolve();
let renderPending = false;
let annotationRestore = null;
let regionStart = null;
let suppressImageClick = false;

function present(element, kind = 'content') {
  if (!element?.animate || reduceMotion()) return;
  element.getAnimations().forEach(animation => animation.cancel());
  const styles = getComputedStyle(document.documentElement);
  const raw = styles.getPropertyValue(`--somae-motion-duration-${kind}`).trim();
  const duration = raw.endsWith('ms') ? parseFloat(raw) : raw.endsWith('s') ? parseFloat(raw) * 1000 : kind === 'summon' ? 350 : 210;
  const easing = styles.getPropertyValue('--somae-motion-easing-standard').trim() || 'cubic-bezier(.16,1,.3,1)';
  element.animate([{ opacity: .25, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration, easing });
}
window.addEventListener('somae:summon', () => { fit(); present($('#main'), 'summon'); });
function restoreFocus(preferred = document.activeElement) {
  window.focus();
  const target = preferred instanceof HTMLElement && ![document.body, document.documentElement].includes(preferred) && preferred.isConnected && preferred.getClientRects().length && !preferred.closest('dialog:not([open])') ? preferred : $('#main');
  target?.focus({ preventScroll: true });
}
window.addEventListener('somae:focus', () => { window.focus(); restoreFocus(); });
window.addEventListener('somae:preferences-changed', () => { if (reduceMotion()) document.getAnimations().forEach(animation => animation.cancel()); });
window.addEventListener('somae:signal-open', event => {
  if (typeof event.detail?.id !== 'string') return;
  signalToOpen = event.detail.id;
  openNotifiedSignal();
});
function openNotifiedSignal() {
  if (busy || !signalToOpen) return;
  const id = signalToOpen; signalToOpen = undefined;
  void guarded(async () => {
    await draftWrites;
    await refresh();
    const target = data.signals.find(s => s.id === id && s.state === 'active' && !s.cleared);
    if ($('#dialog').open) closeDialog();
    state.tab = 'inbox'; state.later = !!target?.view?.set_aside;
    state.index = target ? Math.max(0, queue().findIndex(s => s.id === target.id)) : 0;
    state.option = 0; render(); restoreFocus($('#main'));
  });
}




async function request(path, value) {
  const response = await fetch(path, value === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.message ?? 'Please try again.'), { code: body.error, status: response.status });
  return body;
}
const operation = value => request('/api/operations', { idempotency_key: uuid(), ...value });
function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3800); }
function queue() { return data.signals.filter(s => s.state === 'active' && !s.cleared && !!s.view?.set_aside === state.later).sort((a, b) => a.created_at.localeCompare(b.created_at)); }
function signal() { const list = queue(); state.index = Math.min(state.index, Math.max(0, list.length - 1)); return list[state.index]; }
const conversation = id => data.conversations.find(c => c.id === id);
const itemsFor = id => data.items.filter(item => item.conversation_id === id);
const currentItem = () => data.items.find(item => item.id === state.item);
const currentVersion = item => item?.versions.find(v => v.revision === (state.revision ?? item.latest_revision));
const latestVersion = item => item.versions.find(v => v.revision === item.latest_revision);
const textOf = message => (message?.content ?? []).filter(b => ['text', 'markdown'].includes(b.type)).map(b => b.text).join('\n\n');
const firstRequest = id => data.messages.find(m => m.conversation_id === id && m.authored_by === 'person');
const connection = id => data.connections.find(c => c.id === conversation(id)?.connection_id);
const date = value => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
const extension = item => item.filename.split('.').at(-1)?.toUpperCase();

function draft(id) { if (!data.drafts[id]) data.drafts[id] = { comments: [], note: '', pins: [] }; return data.drafts[id]; }
function persistDraft(id) {
  const value = structuredClone(data.drafts[id]);
  draftWrites = draftWrites.catch(() => {}).then(() => request('/api/drafts', { key: id, draft: value }));
  return draftWrites;
}

function boundQuestionDraft(s) {
  const d = data.drafts[s?.conversation_id];
  return d?.request?.structured === false && reviewRequestIsCurrent(d.request, s) ? d : null;
}

function questionAnswerText(s) {
  const bound = boundQuestionDraft(s);
  if (typeof bound?.request_answer === 'string') return bound.request_answer;
  const saved = data.drafts[`signal_${s.id}`];
  return !saved?.request || reviewRequestIsCurrent(saved.request, s) ? saved?.message ?? '' : '';
}

function saveQuestionText(s, text) {
  const captured = captureReviewRequest(s);
  if (!captured || captured.structured || s.interaction?.response_type !== 'text') return;
  const saved = draft(`signal_${s.id}`);
  saved.request = captured; saved.message = text;
  const bound = boundQuestionDraft(s);
  if (bound && !bound.pending?.uncertain) { bound.request_answer = text; void persistDraft(s.conversation_id).catch(() => toast('Draft could not be saved.')); }
  return persistDraft(`signal_${s.id}`);
}

async function clearSignalAnswer(s, answer) {
  const key = `signal_${s.id}`; const saved = data.drafts[key];
  if (!saved) return;
  if (answer === undefined || saved.message === answer) saved.message = '';
  delete saved.pending;
  await persistDraft(key);
}

function renderHeader() {
  closeControls();
  const count = data.signals.filter(s => s.state === 'active' && !s.cleared && !s.view?.set_aside).length;
  $('#header').innerHTML = `<button class="brand" data-action="inbox" aria-label="Somae inbox"><i class="logo" aria-hidden="true"></i><span>somae</span></button><nav class="header-tabs" aria-label="Main navigation"><button class="${state.tab === 'inbox' ? 'active' : ''}" data-action="inbox"${state.tab === 'inbox' ? ' aria-current="page"' : ''}><span>Inbox</span>${count ? `<span class="count">${count}</span>` : ''}</button><button class="${['library', 'review'].includes(state.tab) ? 'active' : ''}" data-action="library"${['library', 'review'].includes(state.tab) ? ' aria-current="page"' : ''}><span>Library</span></button></nav><div class="header-tools"><button class="icon" data-action="compose" aria-label="New message" title="New message · ⌘N">${icon('plus')}</button><div class="app-menu"><button class="icon menu-trigger ${state.tab === 'connections' ? 'active' : ''}" data-menu="app-menu" aria-label="More" aria-haspopup="menu" aria-controls="app-menu" aria-expanded="false">${icon('dots')}</button><div class="menu-popover" id="app-menu" role="menu" aria-label="Somae" hidden><button class="menu-option" role="menuitem" data-action="connections">${icon('message')}<span>Connections</span></button><button class="menu-option" role="menuitem" data-action="later">${icon('clock')}<span>Set aside</span></button><div class="menu-divider" role="separator"></div><button class="menu-option" role="menuitem" data-action="settings"><span>Settings…</span><kbd>⌘ ,</kbd></button><button class="menu-option" role="menuitem" data-action="hide"><span>Hide Somae</span><kbd>esc</kbd></button></div></div></div>`;
  enhanceControls($('#header'));
}

function attachment(item) {
  const version = latestVersion(item);
  return `<button class="attachment" data-action="review" data-item="${esc(item.id)}">${version.media_type.startsWith('image/') ? `<img class="thumb" src="/api/originals/${esc(version.digest)}" alt="">` : `<span class="doc-thumb">${icon('file')}</span>`}<span><strong>${esc(item.title)}</strong><small>${esc(extension(item))} · v${item.latest_revision}${item.approved ? ` · approved v${item.approved.artifact_revision}` : ''}</small></span></button>`;
}

function renderOnboarding() {
  $('#main').innerHTML = `<section class="onboarding"><div class="eyebrow accent">A place for what your agents make</div><h1>Keep the work.<br>Stay in the flow.</h1><p>Connect Claude Code, give it something to make, and review what comes back. Your files, feedback and versions stay here.</p><form id="start-form"><label>Project folder<input id="workspace" name="workspace" placeholder="/Users/you/Projects/my-project" required autocomplete="off"></label><label><span>Name <small>optional</small></span><input id="session-title" name="title" placeholder="My creative space" autocomplete="off"></label><div class="row"><button class="primary" type="submit">Start Claude here ${icon('arrow')}</button></div></form><button class="secondary" data-action="install-terminal">${icon('message')}Connect my terminal instead</button><p class="tip">Uses your signed-in Claude Code on this Mac. Your folder stays local; only files you publish to Somae are uploaded.</p></section>`;
}

function renderInbox({ focus = true } = {}) {
  const s = signal();
  if (s?.id !== displayedSignal?.id || s?.revision !== displayedSignal?.revision) state.option = 0;
  displayedSignal = s ? structuredClone(s) : null;
  if (!data.connections.length) return renderOnboarding();
  if (!s) {
    const later = data.signals.filter(s => s.state === 'active' && !s.cleared && s.view?.set_aside).length;
    const latest = [...data.deliveries].at(-1);
    const pending = latest && latest.input_state !== 'accepted';
    const deliveryLabel = latest?.input_state === 'ambiguous' ? 'Delivery unconfirmed' : latest?.state === 'received' ? 'Waiting for Claude' : 'Message saved';
    const deliveryDetail = latest?.input_state === 'ambiguous' ? 'Check your Claude session before resending your last message.' : latest?.state === 'received' ? 'Your message reached the integration. Claude has not accepted it yet.' : 'Your message is saved in Somae. It has not reached Claude yet.';
    $('#main').innerHTML = `<section class="all-clear">
      <div class="mark" aria-hidden="true">${icon('check')}</div>
      <div class="all-clear-content">
        <h1>${state.later ? 'Nothing set aside.' : 'All caught up.'}</h1>
        <div class="all-clear-actions">
          <button class="primary" data-action="${state.later ? 'inbox' : 'hide'}">${state.later ? 'Back to inbox' : 'Get back to it'} <kbd>↵</kbd></button>
          <button class="ghost" data-action="compose">New message <kbd>⌘ N</kbd></button>
        </div>
        ${later && !state.later ? `<button class="text-button later-link" data-action="later">${icon('clock')}${later} set aside</button>` : ''}
        ${pending ? `<details class="delivery-note"><summary>${deliveryLabel}</summary><p>${deliveryDetail}</p></details>` : ''}
      </div>
    </section>`;
    return;
  }
  const c = conversation(s.conversation_id);
  const items = itemsFor(s.conversation_id).filter(item => !s.review_request || s.review_request.artifacts.some(ref => ref.artifact_id === item.id));
  const { title, bodyHtml } = signalContent(s, { hasArtifacts: !!items.length });
  const choices = s.interaction?.response_type === 'single_choice' ? s.interaction.actions : [];
  state.option = Math.min(state.option, Math.max(0, choices.length - 1));
  const requestText = textOf(firstRequest(s.conversation_id));
  const requestSummary = requestText.replace(/\s+/g, ' ').trim();
  const requestExcerpt = requestSummary.length > 90 ? `${requestSummary.slice(0, 90).trimEnd()}…` : requestSummary;
  $('#main').innerHTML = `<section class="signal"><div class="signal-meta"><div class="row sender"><div class="avatar" aria-hidden="true"><img src="/claude.svg" alt=""></div><div><div class="name">Claude Code</div><div class="sub"><span class="dot${connection(s.conversation_id)?.online ? '' : ' off'}"></span>${esc(c?.title ?? 'Your agent')}</div></div></div><span class="signal-kind eyebrow">${s.kind === 'question' ? 'NEEDS YOU' : 'NEW SIGNAL'}</span></div><h1>${esc(title)}</h1>${bodyHtml ? `<div class="signal-body">${bodyHtml}</div>` : ''}${s.kind === 'question' && requestText ? `<details class="signal-context"><summary>You asked: ${esc(requestExcerpt)}</summary><p class="original">${esc(requestText)}</p></details>` : ''}${choices.length ? `<div class="options" aria-label="Your answer">${choices.map((choice, i) => `<button class="option ${i === state.option ? 'focused' : ''}" data-action="choose" data-option="${i}"><span class="number">${i + 1}</span><span class="option-label">${esc(choice.label)}</span>${i === state.option ? '<kbd>↵</kbd>' : ''}</button>`).join('')}</div>` : ''}${items.length ? `<div class="attachments">${items.map(attachment).join('')}</div>` : ''}${s.review_request && items.length ? `<div class="actions"><button class="primary" data-action="review" data-item="${esc(items[0].id)}">Review and decide ${icon('arrow')}</button></div>` : ''}${!choices.length && !s.review_request && s.interaction?.mode === 'required' ? `<form id="reply-form" class="reply-box"><label class="visually-hidden" for="signal-reply">Your answer</label><textarea id="signal-reply" placeholder="Your answer…" required>${esc(questionAnswerText(s))}</textarea><button class="primary" type="submit">Send ${icon('arrow')}</button></form>` : ''}${s.interaction?.mode !== 'required' ? `<div class="actions"><div class="action-secondary"><button class="ghost" data-action="reply">Reply <kbd>R</kbd></button>${items.length ? '<button class="secondary" data-action="done">Done</button>' : ''}</div><div class="action-primary">${items.length ? `<button class="primary" data-action="review" data-item="${esc(items[0].id)}">Review the work ${icon('arrow')}</button>` : '<button class="primary" data-action="done">Done <kbd>↵</kbd></button>'}</div></div>` : ''}<footer class="signal-footer"><div class="row pager signal-pager"><button class="icon" data-action="previous" aria-label="Previous signal" title="Previous signal · ←">${icon('left')}</button><span>${String(state.index + 1).padStart(2, '0')} / ${String(queue().length).padStart(2, '0')}</span><button class="icon" data-action="next" aria-label="Next signal" title="Next signal · →">${icon('right')}</button></div><button class="ghost details-control" data-action="details" title="Conversation details">${icon('plus')} Details</button><button class="ghost set-aside" data-action="aside" title="${state.later ? 'Return to inbox' : 'Set aside'} · ⌘←">${state.later ? 'Return to inbox' : 'Set aside'} <kbd>⌘ ←</kbd></button></footer></section>`;
  if (choices.length && focus) requestAnimationFrame(() => $('.option.focused')?.focus({ preventScroll: true }));
}

function renderLibrary() {
  const query = state.search.trim().toLowerCase();
  const items = data.items.filter(item => !query || [item.title, item.filename, ...item.versions.flatMap(v => (v.blocks ?? []).map(b => b.text))].join(' ').toLowerCase().includes(query));
  const groups = [...new Set(items.map(i => i.conversation_id))];
  const contents = !items.length ? `<div class="empty"><h1>${query ? 'Nothing here yet.' : 'Good work stays.'}</h1><p>${query ? 'Try another name or phrase.' : 'Documents, images and their versions will arrive here from Claude. The approved ones stay pinned, even as new drafts arrive.'}</p><button class="primary" data-action="compose">Make something ${icon('plus')}</button></div>` : groups.map(id => `<section class="collection"><div class="row spread collection-title"><span>${esc(conversation(id)?.title ?? 'Your work')}</span><small>Claude Code · ${date(items.find(i => i.conversation_id === id).created_at)}</small></div><div class="grid">${items.filter(i => i.conversation_id === id).map(item => { const v = latestVersion(item); return `<button class="work-card" data-action="review" data-item="${esc(item.id)}"><div class="preview">${v.media_type.startsWith('image/') ? `<img src="/api/originals/${esc(v.digest)}" alt="${esc(item.title)}">` : `<div class="paper-preview"><strong>${esc(v.blocks?.[0]?.text ?? item.title)}</strong>${esc(v.blocks?.slice(1, 3).map(b => b.text).join(' ').slice(0, 250) ?? 'Original file retained')}</div>`}</div><div class="card-info"><strong>${esc(item.title)}</strong><small>${esc(extension(item))} · v${item.latest_revision}${item.approved ? `<span class="approved">✓ Approved v${item.approved.artifact_revision}</span>` : ''}</small></div></button>`; }).join('')}</div></section>`).join('');
  const results = $('#library-results');
  if (results) results.innerHTML = contents;
  else $('#main').innerHTML = `<section class="library"><div class="row spread library-heading"><h1 class="page-title">Your library.</h1><input class="search" id="library-search" type="search" aria-label="Search your work" placeholder="Find something you made…" value="${esc(state.search)}"></div><div id="library-results">${contents}</div></section>`;
}

function paper(version, comments, prior) {
  if (!version?.blocks) return '<div class="paper"><h2>Original file retained.</h2><p>This format is available to download. Its specialized review viewer will come later.</p></div>';
  const d = draft(currentItem()?.conversation_id);
  const pending = d.annotation?.artifact_id === currentItem()?.id && d.annotation.revision === version.revision ? d.annotation : null;
  return `<article class="paper">${version.blocks.map(block => {
    const tag = /^(h[1-6]|p|li|pre|blockquote|td|th)$/.test(block.type) ? (['td', 'th'].includes(block.type) ? 'p' : block.type) : 'p';
    const notes = comments.filter(c => c.anchor?.block_id === block.id);
    const active = notes.find(c => d.comments.indexOf(c) === state.activeComment)?.anchor ?? (pending?.anchor.block_id === block.id ? pending.anchor : null);
    const highlight = active && block.text.slice(active.start, active.end) === active.quote;
    const text = highlight ? `${esc(block.text.slice(0, active.start))}<mark class="annotation-highlight">${esc(block.text.slice(active.start, active.end))}</mark>${esc(block.text.slice(active.end))}` : esc(block.text);
    // Badges are siblings: their labels must never enter the block's UTF-16 offsets.
    const badges = notes.map(c => { const i = d.comments.indexOf(c); return `<button class="annotation-pin text-pin ${i === state.activeComment ? 'is-selected' : ''}" data-action="locate-comment" data-index="${i}" aria-label="Show comment ${i + 1}">${i + 1}</button>`; }).join('');
    return `<div class="paper-block${highlight ? ' is-selected' : ''}"><${tag} data-block="${esc(block.id)}"${prior && prior.blocks?.find(b => b.id === block.id)?.text !== block.text ? ' class="changed"' : ''}>${text}</${tag}>${badges ? `<span class="text-pins">${badges}</span>` : ''}</div>`;
  }).join('')}</article>`;
}

function annotationComposer(d) {
  const a = annotationForAsset(d, currentItem()?.id);
  if (!a) return '';
  const item = data.items.find(item => item.id === a.artifact_id);
  if (a.collapsed) return `<div class="annotation-resume"><button class="ghost" data-action="resume-annotation">${icon('edit')}Resume draft</button><button class="icon" data-action="discard-annotation" aria-label="Discard unfinished comment">${icon('close')}</button></div>`;
  const stale = !item || item.latest_revision !== a.revision;
  return `<form id="annotation-form" class="annotation-composer" aria-label="${a.edit_index === undefined ? 'Add comment' : 'Edit comment'}">
    ${a.anchor.quote ? `<blockquote>${esc(a.anchor.quote)}</blockquote>` : ''}
    ${stale ? '<p class="annotation-stale">A newer copy arrived. This comment stays on the version you reviewed.</p>' : ''}
    <label class="visually-hidden" for="annotation-text">Your comment</label>
    <textarea id="annotation-text" name="text" rows="2" placeholder="Write a comment…" required${stale ? ' readonly' : ''}>${esc(a.text)}</textarea>
    ${a.kind === 'replace' ? `<label for="replacement-text">Suggested replacement</label><textarea id="replacement-text" name="replacement" rows="2" placeholder="Replacement text…"${stale ? ' readonly' : ''}>${esc(a.replacement ?? '')}</textarea>` : ''}
    <div class="annotation-compose-actions"><button class="ghost" type="button" data-action="cancel-annotation">Cancel</button><button class="secondary" type="submit"${stale ? ' disabled' : ''}>Save <kbd>↵</kbd></button></div>
  </form>`;
}

function renderReview() {
  cancelImageGesture();
  const item = currentItem();
  if (!item) { state.tab = 'library'; return renderLibrary(); }
  const version = currentVersion(item);
  const historical = version.revision !== item.latest_revision;
  const reviewDraft = draft(item.conversation_id);
  const stale = reviewDraft.pins?.some(p => data.items.find(i => i.id === p.artifact_id)?.latest_revision !== p.revision);
  const source = data.signals.find(s => s.id === reviewDraft.request?.signal_id);
  const requestStale = reviewDraft.request && !reviewRequestIsCurrent(reviewDraft.request, source);
  const scopeMismatch = source?.review_request && !sameReviewPins(reviewDraft.pins, source.review_request.artifacts);
  const retrying = !!reviewDraft.pending?.uncertain;
  const retry = retrying ? reviewDraft.pending.operation?.decision : null;
  const question = reviewDraft.request?.structured === false;
  const retrySource = reviewDraft.pending?.operation?.source_request;
  const questionRetry = retrying && question && !reviewDraft.pending.operation?.decision && retrySource?.signal_id === reviewDraft.request.signal_id && retrySource?.expected_revision === reviewDraft.request.expected_revision && retrySource?.interaction_id === reviewDraft.request.interaction_id;
  const blocked = historical || stale || scopeMismatch || requestStale || retrying;
  const comments = (reviewDraft.comments ?? []).filter(c => c.artifact_id === item.id && c.revision === version.revision);
  const pending = annotationForAsset(reviewDraft, item.id);
  const pendingHere = pending?.artifact_id === item.id && pending.revision === version.revision;
  const image = version.media_type.startsWith('image/');
  const previous = item.versions.find(v => v.revision === version.revision - 1);
  const savedReviews = data.reviews.filter(r => r.conversation_id === item.conversation_id);
  const imageMark = (c, index, unfinished = false) => {
    const a = c.anchor;
    const point = a.width <= .003 && a.height <= .003;
    return `${point || (!unfinished && index !== state.activeComment) ? '' : `<span class="region ${unfinished ? 'is-pending' : 'is-selected'}" style="left:${a.x * 100}%;top:${a.y * 100}%;width:${a.width * 100}%;height:${a.height * 100}%"></span>`}<button class="annotation-pin image-pin ${unfinished ? 'is-pending' : ''} ${index === state.activeComment ? 'is-selected' : ''}" data-action="${unfinished ? 'resume-annotation' : 'locate-comment'}"${unfinished ? '' : ` data-index="${index}"`} style="left:${(a.x + a.width / 2) * 100}%;top:${(a.y + a.height / 2) * 100}%" aria-label="${unfinished ? 'Resume unfinished note' : `Show comment ${index + 1}`}">${unfinished ? '+' : index + 1}</button>`;
  };
  const canvas = image ? `<div class="image-stage"><div class="image-surface ${state.marking ? 'marking' : ''} ${historical ? 'read-only' : ''}" id="image-surface"><img id="artifact-image" src="/api/originals/${esc(version.digest)}" alt="${esc(item.title)}" draggable="false">${comments.filter(c => c.anchor.type === 'region' && !(pendingHere && pending.edit_index === reviewDraft.comments.indexOf(c))).map(c => imageMark(c, reviewDraft.comments.indexOf(c))).join('')}${pendingHere && pending.anchor.type === 'region' ? imageMark(pending, -1, true) : ''}<span id="drawing-region" class="region" hidden></span></div><div class="image-help">${historical ? '<span>Earlier version · read only</span>' : `<span>Click to comment · drag to select</span>`}</div></div>` : paper(version, comments);

  const comparison = previous && state.compare ? `<div class="compare"><div><div class="compare-label">PREVIOUS · V${previous.revision}</div>${image ? `<img style="max-width:100%;border-radius:5px" src="/api/originals/${esc(previous.digest)}" alt="Previous version">` : paper(previous, [])}</div><div><div class="compare-label">THIS VERSION · V${version.revision}</div>${image ? canvas : paper(version, comments, previous)}</div></div>` : canvas;
  const protectedEdit = [reviewDraft.annotation, ...Object.values(reviewDraft.parked_annotations ?? {})].some(a => a?.edit_index !== undefined);
  const cards = (reviewDraft.comments ?? []).map((c, i) => {
    if (c.artifact_id !== item.id || c.revision !== version.revision) return '';
    const target = data.items.find(a => a.id === c.artifact_id);
    const readOnly = historical || retrying || c.revision !== target?.latest_revision;
    return `<article class="comment-card ${i === state.activeComment ? 'is-selected' : ''}" id="comment-${i}" data-comment-index="${i}">
      <div class="comment-row"><button class="comment-heading" data-action="locate-comment" data-index="${i}" aria-label="Locate comment ${i + 1}"><span class="comment-number">${i + 1}</span></button><div class="comment-card-actions"><button class="comment-edit" data-action="edit-comment" data-index="${i}"${readOnly || pending ? ' disabled' : ''} aria-label="Edit note ${i + 1}" title="Edit comment">${icon('edit')}</button><button class="remove" data-action="remove-comment" data-index="${i}"${readOnly || pending || protectedEdit ? ' disabled' : ''} aria-label="Remove note ${i + 1}" title="Remove comment">${icon('close')}</button></div></div>
      <button class="comment-locate" data-action="locate-comment" data-index="${i}">${c.anchor.quote ? `<span class="quote">${esc(c.anchor.quote)}</span>` : ''}<span class="comment-copy">${esc(c.text)}</span>${c.kind === 'replace' ? `<span class="replacement"><span>Suggested replacement</span>${esc(c.replacement)}</span>` : ''}</button>
    </article>`;
  }).join('');
  const noteCount = comments.length;
  const commentList = `<div id="comment-list">${cards}</div>`;
  const status = reviewDraft.pending?.uncertain ? 'Send unconfirmed. Retry safely.' : requestStale ? 'This request changed. Your comments are saved.' : '';

  $('#main').innerHTML = `<div class="review-top"><button class="icon" data-action="back" aria-label="Back">${icon('left')}</button><div class="grow review-title-group"><h1 class="review-title">${esc(item.title)}</h1><div class="review-meta">Claude Code · ${esc(conversation(item.conversation_id)?.title ?? '')}</div></div><div class="review-tools"><select id="version-picker" aria-label="Artifact version">${[...item.versions].reverse().map(v => `<option value="${v.revision}"${v.revision === version.revision ? ' selected' : ''}>Version ${v.revision}${item.approved?.artifact_revision === v.revision ? ' · approved' : ''}</option>`).join('')}</select>${previous ? `<button class="icon optional ${state.compare ? 'active' : ''}" data-action="compare" aria-pressed="${state.compare}" aria-label="Compare with previous version" title="Compare with previous version">${icon('compare')}</button>` : ''}<a class="download" href="/api/originals/${esc(version.digest)}?download" download="${esc(version.filename)}" title="Download original" aria-label="Download original">${icon('download')}</a></div></div>
  <div class="review-layout"><div class="canvas" id="canvas"><div class="asset-tabs">${itemsFor(item.conversation_id).filter(i => !reviewDraft.request?.structured || reviewDraft.pins.some(p => p.artifact_id === i.id)).map(i => `<button class="${i.id === item.id ? 'active' : ''}" data-action="review" data-item="${esc(i.id)}">${i.versions.at(-1).media_type.startsWith('image/') ? icon('region') : icon('file')}${esc(i.title)}${reviewDraft.comments?.filter(c => c.artifact_id === i.id && c.revision === i.latest_revision).length ? `<span class="asset-comment-count">${reviewDraft.comments.filter(c => c.artifact_id === i.id && c.revision === i.latest_revision).length}</span>` : ''}</button>`).join('')}</div><div class="new-version" id="new-version"${version.revision === item.latest_revision ? ' hidden' : ''}>You’re looking at v${version.revision}. A newer version is here.<button data-action="latest">See v${item.latest_revision} ${icon('arrow')}</button></div>${comparison}</div>
  <aside class="review-aside" aria-label="Artifact review"><div class="review-aside-header"><h2>Comments${noteCount ? ` <span class="comment-count">${noteCount}</span>` : ''}</h2>${image && !historical ? `<button class="icon" data-action="image-comment" aria-label="Comment on whole image" title="Comment on whole image"${retrying ? ' disabled' : ''}>${icon('plus')}</button>` : ''}</div>
    <div class="review-body"><div id="annotation-slot">${annotationComposer(reviewDraft)}</div>
      ${commentList}
      ${!image && !noteCount && !pending ? '<div class="feedback-empty">Select text to comment.</div>' : ''}
      ${reviewDraft.note?.trim() ? `<details class="review-note-saved"><summary>Review note</summary><label><span class="visually-hidden">Review note</span><textarea id="review-note" rows="2"${historical || retrying ? ' disabled' : ''}>${esc(reviewDraft.note)}</textarea></label></details>` : ''}
      ${(stale || requestStale || scopeMismatch) && !retrying ? '<div class="submission-note">The work changed. Your comments stay on the copy you reviewed.<button class="text-button" data-action="reset-review">Discard draft and review latest</button></div>' : ''}
    </div>
    <div class="review-dock">${reviewRequestControls(item, reviewDraft)}
      ${question ? `${questionAnswerControls(reviewDraft, source, blocked)}<button class="primary question-send" data-action="answer-review" aria-keyshortcuts="Meta+Enter Control+Enter"${blocked && !questionRetry ? ' disabled' : ''}>${reviewDraft.pending?.uncertain ? 'Retry answer' : 'Send answer'} <kbd>⌘ ↵</kbd></button>` : `<div class="review-decisions"><button class="secondary" data-action="submit-review" data-decision="reject" aria-keyshortcuts="Meta+Shift+Enter Control+Shift+Enter"${blocked && retry !== 'reject' ? ' disabled' : ''}>${retry === 'reject' ? 'Retry request changes' : 'Request changes'}</button><button class="primary" data-action="submit-review" data-decision="approve" aria-keyshortcuts="Meta+Enter Control+Enter"${blocked && retry !== 'approve' ? ' disabled' : ''}>${retry === 'approve' ? 'Retry approve' : 'Approve'} <kbd>⌘ ↵</kbd></button></div>`}
      <div class="draft-status" id="draft-status" role="status">${status}</div>
      ${savedReviews.length || item.approved || item.decision ? `<div class="review-history">${!question && item.decision ? `<span>${item.decision.decision === 'approve' ? 'Approved' : 'Changes requested'} v${item.decision.artifact_revision}</span>` : !question && item.approved ? `<span>Approved v${item.approved.artifact_revision}</span>` : ''}<button class="text-button" data-action="details">History ${icon('clock')}</button></div>` : ''}
    </div>
  </aside></div>`;

  enhanceControls($('#main'));
  growCommentFields();
}

function growCommentFields() {
  document.querySelectorAll('.review-aside textarea').forEach(field => {
    field.style.height = 'auto';
    field.style.height = `${Math.min(240, Math.max(64, field.scrollHeight))}px`;
  });
}
window.addEventListener('resize', () => { if (state.tab === 'review') growCommentFields(); });

function renderConnections() {
  const restoreHistoryFocus = document.activeElement?.matches('#past-sessions > summary');
  const current = data.local_sessions.filter(s => s.online || s.managed);
  const past = data.local_sessions.filter(s => !s.online && !s.managed);
  const card = (s, previous = false) => `<div class="session-card${previous ? ' past-session' : ''}">${previous ? '' : '<div class="avatar" aria-hidden="true"><img src="/claude.svg" alt=""></div>'}<div class="session-info"><strong><span class="dot${s.online ? '' : ' off'}"></span>${esc(s.name)}</strong><div class="folder">${esc(s.workspace)}</div><div class="folder">${s.online ? 'Connected' : s.managed ? 'Waiting for Claude' : 'Disconnected'} · ${s.mode === 'terminal' ? 'Your terminal' : 'Started by Somae'}</div></div>${s.managed ? `<button class="ghost" data-action="session-console" data-connection="${esc(s.id)}">Open Claude</button>` : ''}${!s.online && s.mode === 'managed' && !s.managed ? `<button class="secondary" data-action="resume" data-connection="${esc(s.id)}">Reconnect</button>` : s.online ? `<button class="ghost" data-action="compose" data-connection="${esc(s.id)}">Message ${icon('arrow')}</button>` : ''}</div>`;
  $('#main').innerHTML = `<section class="connections"><div class="row spread"><h1 class="page-title">Your connections.</h1><button class="primary" data-action="start-session">${icon('plus')}New local session</button></div><p class="connection-note">Claude stays on this Mac, in the folder you choose. Somae keeps your messages and the files you send to its library.</p><div class="current-sessions" aria-label="Current sessions">${current.length ? current.map(s => card(s)).join('') : '<p class="connections-empty">No Claude sessions are connected right now.</p>'}</div>${past.length ? `<details class="past-sessions" id="past-sessions"${state.pastSessions ? ' open' : ''}><summary>${icon('down')}<span>Disconnected sessions</span><span class="past-count">${past.length}</span></summary><p class="connection-note">Past connections stay here. Their messages and files remain in your library.</p>${past.map(s => card(s, true)).join('')}</details>` : ''}<div class="terminal-setup"><button class="secondary" data-action="install-terminal">Connect Claude in my terminal</button><p class="connection-note">One setup, then launch with <code>somae-claude</code> in a project. Your usual terminal workflow stays available.</p></div></section>`;
  if (restoreHistoryFocus) ($('#past-sessions > summary') ?? $('[data-action="start-session"]'))?.focus({ preventScroll: true });
}

function render({ motion = true } = {}) {
  cancelImageGesture();
  closeControls();
  selected = null; $('#selection-tools').hidden = true;
  $('#main').dataset.view = state.tab;
  $('#main > .offline-banner')?.remove();
  renderHeader();
  if (state.tab === 'inbox') renderInbox({ focus: motion });
  else if (state.tab === 'library') renderLibrary();
  else if (state.tab === 'review') renderReview();
  else renderConnections();
  if (data.offline) $('#main').insertAdjacentHTML('afterbegin', '<div class="offline-banner">Offline · showing your saved library. Drafts stay on this Mac.</div>');
  enhanceControls($('#main'));
  if (motion) fit(() => present($('#main')));
}

async function refresh(force = false) {
  const previous = JSON.stringify([data.signals, data.items, data.connections, data.deliveries, data.local_sessions, data.offline]);
  const next = await request('/api/state');
  const localDrafts = data.drafts;
  data = { ...data, ...next, drafts: { ...next.drafts, ...localDrafts } };
  const changed = previous !== JSON.stringify([data.signals, data.items, data.connections, data.deliveries, data.local_sessions, data.offline]);
  renderPending ||= changed;
  if (force) { renderPending = false; render(); }
  else if (renderPending && !$('#dialog').open && !controlsOpen()) {
    if (state.tab === 'review') { renderHeader(); const banner = $('#new-version'); if (banner && currentItem() && currentVersion(currentItem()).revision < currentItem().latest_revision) { banner.hidden = false; banner.querySelector('button').innerHTML = `See v${currentItem().latest_revision} ${icon('arrow')}`; } renderPending = false; }
    else if (!['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement?.tagName) && !document.activeElement?.closest('.select-control')) { renderPending = false; render({ motion: false }); }
  }
}

function openDialog(html, submit) {
  modalRestore = document.activeElement;
  closeControls();
  $('#dialog').innerHTML = html;
  $('#dialog').showModal();
  enhanceControls($('#dialog'));
  present($('#dialog')); 
  if (submit) $('#dialog form')?.addEventListener('submit', event => { event.preventDefault(); void guarded(() => submit(new FormData(event.target))); });
  requestAnimationFrame(() => $('#dialog [autofocus]')?.focus());
}
function closeDialog() { closeControls(); $('#dialog').close(); restoreFocus(modalRestore); }

function compose(connectionId, replyTo, offeredSignal) {
  const online = data.connections.filter(c => replyTo ? c.id === connectionId : data.local_sessions.find(s => s.id === c.id)?.online);
  if (!online.length) { state.tab = 'connections'; render(); toast('Connect Claude on this Mac first.'); return; }
  const draftKey = offeredSignal ? `signal_${offeredSignal.id}` : replyTo ?? 'new_message';
  const saved = draft(draftKey);
  const initialText = offeredSignal?.kind === 'question' && offeredSignal.interaction?.response_type === 'text' ? questionAnswerText(offeredSignal) : saved.message ?? '';
  const destination = connectionId ?? saved.connection_id;
  if (!replyTo && destination && !online.some(c => c.id === destination)) {
    state.tab = 'connections'; render();
    toast('Your draft’s Claude session is disconnected. Choose a connected session to continue.');
    return;
  }
  openDialog(`<form><h2>${replyTo ? 'A word back.' : 'What’s on your mind?'}</h2><p>${replyTo ? 'Reply in this same Claude conversation. If it is offline, the reply stays queued.' : 'Message a connected Claude session on this Mac.'}</p><label>To<select name="connection" id="compose-connection"${replyTo ? ' disabled' : ''}>${online.map(c => `<option value="${esc(c.id)}"${c.id === destination ? ' selected' : ''}>Claude · ${esc(c.name)}</option>`).join('')}</select></label><label class="visually-hidden" for="compose-text">Your message</label><textarea id="compose-text" name="message" placeholder="Make something worth keeping…" autofocus required class="compose-text">${esc(saved.message ?? '')}</textarea><div class="dialog-actions"><button type="button" data-action="cancel">Cancel</button><button class="primary" type="submit">Send message <kbd>⌘ ↵</kbd></button></div></form>`, async form => {
    saved.message = offeredSignal?.interaction ? String(form.get('message')) : String(form.get('message')).trim();
    if (offeredSignal?.interaction) {
      await saveQuestionText(offeredSignal, saved.message);
      if (await respond({ text: saved.message }, offeredSignal) !== false) closeDialog();
      return;
    }
    const content = { type: 'message.send', ...(replyTo ? { conversation_id: replyTo } : { connection_id: String(form.get('connection')), title: saved.message.split('\n')[0].slice(0, 80) }), text: saved.message };
    const fingerprint = JSON.stringify(content);
    if (saved.pending?.fingerprint !== fingerprint) saved.pending = { fingerprint, key: uuid() };
    await persistDraft(draftKey);
    await operation({ ...content, idempotency_key: saved.pending.key });
    saved.message = ''; delete saved.pending; await persistDraft(draftKey);
    closeDialog(); state.tab = 'inbox'; state.index = 0; await refresh(true); toast('Saved and sent to your Claude connection.');
  });
  if (!replyTo) { saved.connection_id = $('#compose-connection').value; void persistDraft(draftKey).catch(() => toast('Draft could not be saved.')); }
  $('#compose-connection').addEventListener('change', event => { saved.connection_id = event.target.value; void persistDraft(draftKey).catch(() => toast('Draft could not be saved.')); });
  $('#compose-text').value = initialText;
  $('#compose-text').addEventListener('input', event => {
    saved.message = event.target.value;
    void (saveQuestionText(offeredSignal, event.target.value) ?? persistDraft(draftKey)).catch(() => toast('Draft could not be saved.'));
  });
}

function startSession() {
  openDialog('<form><h2>A new space with Claude.</h2><p>Choose a folder for the local session. Claude uses your existing login.</p><label>Project folder<input name="workspace" id="workspace" placeholder="/Users/you/Projects/my-project" required autofocus></label><label>Name<input name="title" placeholder="My creative space"></label><div class="dialog-actions"><button type="button" data-action="cancel">Cancel</button><button class="primary" type="submit">Start Claude</button></div></form>', async form => {
    await request('/api/sessions/start', { workspace: form.get('workspace'), title: form.get('title') });
    closeDialog(); await refresh(true); toast('Claude is connecting. Give it a moment.');
  });
}

function reviewSources(id) {
  return data.signals.filter(s => s.conversation_id === id && s.state === 'active' && captureReviewRequest(s));
}

function reviewRequestControls(item, d) {
  const sources = reviewSources(item.conversation_id);
  const source = data.signals.find(s => s.id === d.request?.signal_id);
  const onlySource = reviewRequestIsCurrent(d.request, source) && (d.request?.structured || (sources.length === 1 && sources[0].id === source?.id));
  const pins = d.pins ?? [];
  const scope = `<div class="review-scope"><span>${pins.length === 1 ? '1 file' : `${pins.length} files`} ${d.request?.structured === false ? 'for context' : 'in this review'}</span></div>`;
  const selector = !onlySource && (sources.length || d.request) ? `<label class="review-source-label"><span>Replying to</span><select id="review-request" aria-label="Review request"${d.pending?.uncertain ? ' disabled' : ''}><option value=""${!d.request ? ' selected' : ''}>The files only</option>${d.request && !sources.some(s => s.id === d.request.signal_id) ? `<option value="${esc(d.request.signal_id)}" selected>Previous request · no longer active</option>` : ''}${sources.map(s => `<option value="${esc(s.id)}"${s.id === d.request?.signal_id ? ' selected' : ''}>${esc(textOf(s).replace(/\s+/g, ' ').slice(0, 110))}</option>`).join('')}</select></label>` : '';
  let original = '';
  if (source) {
    const text = textOf(source);
    const title = text.split('\n')[0];
    original = `<details class="review-question-details"><summary title="View the full request">${esc(title.length > 110 ? title.slice(0, 110) + '…' : title)}</summary><div class="original-question">${esc(text)}</div></details>`;
  }
  return `<div class="review-request-context">${scope}${selector}${original}</div>`;
}

function questionAnswerControls(d, source, disabled) {
  if (source?.interaction?.response_type === 'single_choice') {
    const actions = source.interaction.actions;
    const selected = actions.some(a => a.id === d.request_answer) ? d.request_answer : actions[0]?.id;
    return `<fieldset class="review-question-answers" id="review-choice"${disabled ? ' disabled' : ''}><legend class="visually-hidden">Your answer</legend>${actions.map((a, i) => `<label class="review-answer-option"><input type="radio" name="review-choice" value="${esc(a.id)}"${a.id === selected ? ' checked' : ''}><span>${esc(a.label)}</span></label>`).join('')}</fieldset>`;
  }
  return `<label class="review-text-answer"><span class="visually-hidden">Your answer</span><textarea id="review-answer" rows="2" maxlength="${source?.interaction?.max_length ?? 4000}" placeholder="Your answer…"${disabled ? ' disabled' : ''}>${esc(d.request_answer ?? '')}</textarea></label>`;
}

async function reviewItem(id) {
  let item = data.items.find(i => i.id === id); if (!item) return;
  const prior = state.tab === 'review' ? currentItem() : null;
  if (prior && prior.conversation_id !== item.conversation_id) {
    if (!parkAnnotation(draft(prior.conversation_id)).ok) return;
    await persistDraft(prior.conversation_id);
  }
  const origin = state.tab === 'inbox' && displayedSignal?.conversation_id === item.conversation_id ? displayedSignal : null;
  const d = draft(item.conversation_id);
  const sources = reviewSources(item.conversation_id);
  const structured = sources.filter(s => s.review_request?.artifacts.some(p => p.artifact_id === id));
  const proposed = captureReviewRequest(origin) ? origin : structured.length === 1 ? structured[0] : sources.length === 1 ? sources[0] : null;
  if (!d.request && proposed) { d.request = captureReviewRequest(proposed); d.request_answer = ''; }
  const source = data.signals.find(s => s.id === d.request?.signal_id);
  const signalDraft = source && data.drafts[`signal_${source.id}`];
  if (d.request?.structured === false && source?.interaction?.response_type === 'text' && reviewRequestIsCurrent(d.request, source) && reviewRequestIsCurrent(signalDraft?.request, source) && !d.pending?.uncertain) d.request_answer = signalDraft.message ?? '';
  if (origin) d.origin_signal = { id: origin.id, revision: origin.revision };
  if (!d.pins?.length) d.pins = proposed?.review_request?.artifacts ? structuredClone(proposed.review_request.artifacts) : itemsFor(item.conversation_id).map(i => ({ artifact_id: i.id, revision: i.latest_revision }));
  if (d.request?.structured && d.pins?.length && !d.pins.some(p => p.artifact_id === id)) {
    item = data.items.find(i => i.id === d.pins[0].artifact_id) ?? item; id = item.id;
    toast('Your open review covers a specific set of files. Finish or restart it before changing the set.');
  }
  if (d.annotation && (d.annotation.artifact_id !== id || d.annotation.revision !== item.latest_revision)) {
    if (!parkAnnotation(d).ok) { toast('Your unfinished comment is safe. Finish it before switching.'); return; }
  }
  state.tab = 'review'; state.item = id; state.conversation = item.conversation_id; state.revision = item.latest_revision; state.compare = false; state.marking = false; state.activeComment = -1;
  await persistDraft(item.conversation_id);
  render();
}

function focusAnnotation() {
  requestAnimationFrame(() => {
    const editor = $('#annotation-text');
    editor?.focus({ preventScroll: true });
    editor?.closest('.annotation-composer')?.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'instant' : 'smooth' });
  });
}

function annotate(kind, anchor = selected, editIndex) {
  const item = currentItem(); const version = currentVersion(item); if (!item || !anchor) return;
  if (version.revision !== item.latest_revision) { toast('Earlier copies stay read-only. Choose the latest version to add feedback.'); return; }
  const d = draft(item.conversation_id);
  if (d.pending?.uncertain) { toast('Retry the unconfirmed send before editing comments.'); return; }
  if (d.annotation && d.annotation.artifact_id !== item.id && !parkAnnotation(d).ok) return;
  const previous = annotationForAsset(d, item.id);
  if (previous && (previous.text.trim() || previous.replacement?.trim() || previous.edit_index !== undefined)) {
    if (!resumeAnnotation(d, item.id).ok) return;
    state.revision = d.annotation.revision;
    renderReview(); focusAnnotation();
    toast('Finish or discard this draft first.');
    return;
  }
  discardAnnotation(d, item.id);
  annotationRestore = document.activeElement;
  const original = editIndex === undefined ? null : d.comments?.[editIndex];
  d.annotation = { artifact_id: item.id, revision: version.revision, kind, anchor: structuredClone(anchor), text: original?.text ?? '', replacement: original?.replacement ?? '', ...(original ? { edit_index: editIndex, original: JSON.stringify(original) } : {}), collapsed: false };
  state.marking = false; state.activeComment = editIndex ?? -1;
  $('#selection-tools').hidden = true;
  window.getSelection()?.removeAllRanges();
  void persistDraft(item.conversation_id).catch(() => toast('Draft could not be saved.'));
  renderReview(); focusAnnotation();
}

async function saveAnnotation() {
  const id = currentItem()?.conversation_id;
  const d = draft(id); const a = d.annotation;
  if (d.pending?.uncertain) return;
  if (!a) return;
  const target = data.items.find(item => item.id === a.artifact_id);
  if (!target || target.latest_revision !== a.revision) { toast('A newer copy arrived. Your note stays pinned to the earlier version.'); return; }
  if (!a.text.trim()) { focusAnnotation(); return; }
  const comment = { artifact_id: a.artifact_id, revision: a.revision, kind: a.kind, text: a.text.trim(), anchor: structuredClone(a.anchor), ...(a.kind === 'replace' ? { replacement: a.replacement ?? '' } : {}) };
  d.comments ??= [];
  if (a.edit_index !== undefined) {
    if (JSON.stringify(d.comments[a.edit_index]) !== a.original) { toast('This note changed. Your unfinished edit has been kept.'); return; }
    d.comments[a.edit_index] = comment; state.activeComment = a.edit_index;
  } else { d.comments.push(comment); state.activeComment = d.comments.length - 1; }
  d.pins ??= [];
  if (!d.pins.some(p => p.artifact_id === a.artifact_id)) d.pins.push({ artifact_id: a.artifact_id, revision: a.revision });
  delete d.annotation;
  await persistDraft(id);
  renderReview();
  requestAnimationFrame(() => { const card = $(`#comment-${state.activeComment}`); card?.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'instant' : 'smooth' }); card?.querySelector('.comment-heading')?.focus({ preventScroll: true }); });
  toast('Comment saved.');
}

async function closeAnnotation(discard = false) {
  const item = currentItem(); const id = item?.conversation_id; const d = draft(id); const a = annotationForAsset(d, item?.id);
  if (!a) return;
  if (discard || (!a.text.trim() && !a.replacement?.trim() && a.edit_index === undefined)) discardAnnotation(d, item.id);
  else if (!parkAnnotation(d).ok) return;
  await persistDraft(id);
  renderReview(); restoreFocus(annotationRestore);
}

function locateComment(index, source) {
  const d = draft(currentItem()?.conversation_id);
  const comment = d.comments?.[index]; if (!comment) return;
  const target = data.items.find(item => item.id === comment.artifact_id);
  if (!target?.versions.some(v => v.revision === comment.revision)) return;
  if ((state.item !== target.id || state.revision !== comment.revision) && !parkAnnotation(d).ok) return;
  state.item = target.id; state.revision = comment.revision; state.activeComment = index; state.marking = false;
  void persistDraft(target.conversation_id).catch(() => toast('Draft could not be saved.'));
  renderReview();
  requestAnimationFrame(() => {
    const marker = $(`.annotation-pin[data-index="${index}"]`);
    const card = $(`#comment-${index}`);
    marker?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduceMotion() ? 'instant' : 'smooth' });
    const group = card?.closest('details'); if (group) group.open = true;
    card?.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'instant' : 'smooth' });
    (source?.classList.contains('annotation-pin') ? card?.querySelector('.comment-heading') : marker)?.focus({ preventScroll: true });
  });
}

function resetReviewDraft(id) {
  const { comments, note, pins, request: source, request_answer, origin_signal, annotation, parked_annotations, pending, ...other } = draft(id);
  data.drafts[id] = { ...other, ...(pending && pending.operation?.type !== 'review.submit' ? { pending } : {}), comments: [], note: '', pins: [] };
}

async function submitReview(decision, { signal: offeredSignal, answer: offeredAnswer } = {}) {
  const id = offeredSignal?.conversation_id ?? currentItem()?.conversation_id;
  if (!id) return false;
  const d = draft(id);
  if (offeredSignal && !reviewRequestIsCurrent(d.request, offeredSignal)) return false;
  const item = offeredSignal ? data.items.find(i => i.id === d.pins?.[0]?.artifact_id) ?? itemsFor(id)[0] : currentItem();
  if (!item) return false;
  const showDraft = (target = item, revision = target.latest_revision, focus = false) => {
    if ($('#dialog').open) closeDialog();
    state.tab = 'review'; state.item = target.id; state.conversation = id; state.revision = revision; state.compare = false;
    render();
    if (focus) focusAnnotation();
  };
  const question = d.request?.structured === false;
  if (question ? decision !== undefined : !['approve', 'reject'].includes(decision)) return false;
  const retrying = !!d.pending?.uncertain && d.pending.operation?.type === 'review.submit';
  const pendingSource = retrying && d.pending.operation.source_request;
  if (retrying && (d.pending.operation.decision !== decision || d.request && (!pendingSource || pendingSource.signal_id !== d.request.signal_id || pendingSource.expected_revision !== d.request.expected_revision || pendingSource.interaction_id !== d.request.interaction_id))) { toast('Retry the previous send before changing this answer.'); return false; }
  const originalAnswer = pendingSource?.value?.option_id ?? pendingSource?.value?.text;
  if (retrying && offeredAnswer !== undefined && offeredAnswer !== originalAnswer) { showDraft(); toast('The previous answer is unconfirmed. Retry it before choosing another.'); return false; }
  const answer = question ? retrying ? originalAnswer : offeredSignal ? offeredAnswer : ($('#review-choice input:checked')?.value ?? $('#review-answer')?.value ?? d.request_answer ?? '') : undefined;
  if (question) d.request_answer = answer;
  const artifacts = d.pins?.length ? d.pins : [{ artifact_id: item.id, revision: offeredSignal ? item.latest_revision : currentVersion(item).revision }];
  if (!retrying) {
    const prepared = prepareAnnotationsForSubmit(d, data.items, artifacts);
    if (!prepared.ok) {
      let target = item; let revision = item.latest_revision;
      if (prepared.artifact_id) {
        if (d.annotation?.artifact_id !== prepared.artifact_id && !parkAnnotation(d).ok) return false;
        const candidate = data.items.find(item => item.id === prepared.artifact_id);
        if (candidate?.versions.some(v => v.revision === prepared.revision)) { target = candidate; revision = prepared.revision; }
        resumeAnnotation(d, prepared.artifact_id);
      }
      await persistDraft(id); showDraft(target, revision, true);
      toast(prepared.reason === 'stale' ? 'A draft belongs to an earlier version. Review it before sending.' : 'Finish or discard the unfinished comment before sending.');
      return false;
    }
    const hadPending = !!d.annotation || !!Object.keys(d.parked_annotations ?? {}).length;
    d.comments = prepared.comments;
    delete d.annotation; delete d.parked_annotations;
    if (hadPending) { await persistDraft(id); if (!offeredSignal) renderReview(); }
  }
  // A retry reuses the complete original operation, including its original sequence
  // and request revision. A committed response can otherwise make itself look stale.
  const fingerprint = JSON.stringify({ conversation_id: id, artifacts, comments: d.comments ?? [], note: d.note ?? '', decision, request: d.request ?? null, answer });
  if (!retrying && (d.pending?.fingerprint !== fingerprint || !d.pending.operation)) {
    if ((!offeredSignal && currentVersion(item).revision !== item.latest_revision) || artifacts.some(p => data.items.find(i => i.id === p.artifact_id)?.latest_revision !== p.revision)) { showDraft(); toast('The work changed. Your notes stay pinned to the copy you reviewed.'); return false; }
    let source_request;
    if (d.request) {
      const source = data.signals.find(s => s.id === d.request.signal_id);
      if (!reviewRequestIsCurrent(d.request, source)) { showDraft(); toast('This request changed. Your draft is safe; review the latest request before sending.'); return false; }
      if (source.review_request && !sameReviewPins(artifacts, source.review_request.artifacts)) { showDraft(); toast('This request covers a different set of files. Keep your notes and start a review of that exact set.'); return false; }
      source_request = reviewSourceForSubmission(d.request, source, { decision, answer });
      if (!source_request) { showDraft(); $('#review-answer, #review-choice input:checked')?.focus(); toast('Add your answer before sending. Your comments are saved.'); return false; }
    }
    const expected_sequences = Object.fromEntries(artifacts.map(p => { const target = data.items.find(i => i.id === p.artifact_id); return [p.artifact_id, target.decision?.sequence ?? target.approved?.sequence ?? 0]; }));
    d.pending = { fingerprint, operation: { type: 'review.submit', idempotency_key: uuid(), conversation_id: id, artifacts: structuredClone(artifacts), comments: structuredClone(d.comments ?? []), note: d.note ?? '', ...(decision ? { decision, expected_sequences } : {}), ...(source_request ? { source_request } : {}) } };
  }
  await persistDraft(id);
  const origin = d.origin_signal;
  let result;
  try { result = await operation(d.pending.operation); } catch (error) {
    d.pending.uncertain = !error.status || error.status >= 500;
    await persistDraft(id);
    await refresh().catch(() => {}); showDraft();
    throw error;
  }
  resetReviewDraft(id);
  await persistDraft(id);
  if (d.request) await clearSignalAnswer({ id: d.request.signal_id }, sourceTextAnswer(d, answer));
  state.tab = 'inbox'; state.option = 0;
  const s = data.signals.find(s => s.id === origin?.id && s.revision === origin.revision && s.state === 'active' && !s.cleared && s.interaction?.mode !== 'required');
  if (s) await operation({ type: 'inbox.mark', signal_id: s.id, done: true }).catch(() => {});
  await refresh(true);
  toast(`${question ? 'Answer' : decision === 'approve' ? 'Approval' : 'Change request'} sent${d.comments?.length ? ' with comments' : ''}.`);
  return result;
}

function sourceTextAnswer(d, answer) {
  const source = data.signals.find(s => s.id === d.request?.signal_id);
  return source?.interaction?.response_type === 'text' ? answer : undefined;
}

async function respond(value, s = displayedSignal) {
  if (!s?.interaction) return false;
  const bound = boundQuestionDraft(s);
  if (bound && (bound.comments?.length || bound.note?.trim() || bound.annotation || Object.keys(bound.parked_annotations ?? {}).length || bound.pending?.operation?.type === 'review.submit')) {
    return submitReview(undefined, { signal: s, answer: s.interaction.response_type === 'single_choice' ? value.option_id : value.text });
  }
  const saved = draft(`signal_${s.id}`);
  const fingerprint = JSON.stringify([s.id, s.revision, value]);
  if (saved.pending?.fingerprint !== fingerprint) saved.pending = { fingerprint, key: uuid() };
  await persistDraft(`signal_${s.id}`);
  const result = await operation({ idempotency_key: saved.pending.key, type: 'response.submit', signal_id: s.id, expected_revision: s.revision, interaction_id: s.interaction.id, value });
  await clearSignalAnswer(s, value.text);
  if (bound) { resetReviewDraft(s.conversation_id); await persistDraft(s.conversation_id); }
  state.option = 0; await refresh(true); toast('Answer saved. On to the next.');
  return result;
}

async function handle(action, element) {
  if (state.tab === 'review' && ['annotate', 'suggest', 'image-comment', 'mark-region', 'edit-comment', 'remove-comment', 'discard-annotation', 'cancel-annotation', 'resume-annotation'].includes(action) && data.drafts[currentItem()?.conversation_id]?.pending?.uncertain) { toast('Retry the unconfirmed send before editing comments.'); return; }
  if (action === 'settings') { closeControls(); await draftWrites; return request('/api/settings/open', {}); }
  if (action === 'cancel') return closeDialog();
  if (action === 'compose') return compose(element?.dataset.connection);
  if (action === 'start-session') return startSession();
  if (action === 'install-terminal') {
    const result = await request('/api/terminal/install', {});
    openDialog(`<h2>Your terminal is connected.</h2><p>In a project folder, start Claude with:</p><blockquote><code>somae-claude</code></blockquote><p>For an existing conversation, use <code>somae-claude --resume &lt;session-id&gt;</code>. The connection is installed once; the launcher enables it each session.</p><div class="dialog-actions"><button class="primary" data-action="cancel" autofocus>Got it</button></div>`); return result;
  }
  if (action === 'session-console') {
    const id = element.dataset.connection;
    const url = `/api/sessions/terminal?connection=${encodeURIComponent(id)}`;
    const value = await request(url);
    openDialog(`<h2>Claude session.</h2><p>Direct controls for Claude’s own permission and setup prompts. Read the prompt before choosing. Your terminal sessions use their own window.</p><pre class="session-output" id="session-output">${esc(value.output)}</pre><div class="row">${['up','down','1','2','3','enter','escape'].map(key => `<button class="secondary" data-action="session-key" data-url="${esc(url)}" data-key="${key}">${({up:'↑',down:'↓',enter:'Enter',escape:'Esc'})[key] ?? key}</button>`).join('')}</div><div class="dialog-actions"><button class="primary" data-action="cancel">Back to Somae</button></div>`);
    const output = $('#session-output'); output.scrollTop = output.scrollHeight;
    const timer = setInterval(async () => { if (!$('#dialog').open || !$('#session-output')) return clearInterval(timer); try { const fresh = await request(url); output.textContent = fresh.output; output.scrollTop = output.scrollHeight; } catch {} }, 1400); return;
  }
  if (action === 'session-key') { await request(element.dataset.url, { key: element.dataset.key }); return; }
  if (action === 'resume') { await request('/api/sessions/start', { connection_id: element.dataset.connection }); await refresh(true); return toast('Reconnecting the same Claude session.'); }
  if (['inbox', 'library', 'connections', 'later', 'back'].includes(action)) {
    const item = state.tab === 'review' ? currentItem() : null;
    if (item) {
      if (!parkAnnotation(draft(item.conversation_id)).ok) return;
      await persistDraft(item.conversation_id);
    }
    state.tab = action === 'back' ? 'inbox' : action === 'later' ? 'inbox' : action;
    state.later = action === 'later'; state.index = 0;
    await draftWrites.catch(() => {});
    render(); return;
  }
  if (action === 'hide') { await draftWrites; await request('/api/hide', {}); return; }
  if (action === 'previous' || action === 'next') { const length = queue().length; if (length) state.index = (state.index + (action === 'next' ? 1 : -1) + length) % length; state.option = 0; render(); return; }
  if (action === 'review') return reviewItem(element.dataset.item);
  if (action === 'done' || action === 'aside') { const s = displayedSignal; if (!s) return; await operation({ type: 'inbox.mark', signal_id: s.id, ...(action === 'done' ? { done: true } : { set_aside: !s.view?.set_aside }) }); await refresh(true); return; }
  if (action === 'choose') { const option = displayedSignal?.interaction?.actions[Number(element.dataset.option)]; if (option) await respond({ option_id: option.id }); return; }
  if (action === 'reply') return compose(conversation(displayedSignal?.conversation_id)?.connection_id, displayedSignal?.conversation_id, displayedSignal);
  if (action === 'reload') return location.reload();
  if (action === 'details') {
    const id = state.tab === 'review' ? currentItem()?.conversation_id : signal()?.conversation_id;
    openDialog(`<h2>A little more context.</h2><p>${esc(conversation(id)?.title ?? 'Conversation history')}</p><div class="timeline">${data.messages.filter(m => m.conversation_id === id).map(m => `<div class="bubble ${m.authored_by === 'person' ? 'person' : ''}"><div class="eyebrow">${m.authored_by === 'person' ? 'You' : 'Claude'}</div>${esc(textOf(m))}</div>`).join('')}</div><div class="dialog-actions"><button class="primary" data-action="cancel">Back to it</button></div>`); return;
  }
  if (action === 'annotate') return annotate('comment');
  if (action === 'suggest') return annotate('replace');
  if (action === 'locate-comment') return locateComment(Number(element.dataset.index), element);
  if (action === 'resume-annotation' || action === 'locate-annotation') {
    const item = currentItem(); const d = draft(item.conversation_id);
    if (!resumeAnnotation(d, item.id).ok) return;
    const a = d.annotation;
    state.revision = a.revision; state.compare = false;
    await persistDraft(item.conversation_id); renderReview();
    if (action === 'locate-annotation') requestAnimationFrame(() => ($('.image-pin.is-pending') ?? $('.annotation-highlight'))?.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'instant' : 'smooth' }));
    focusAnnotation(); return;
  }
  if (action === 'cancel-annotation') return closeAnnotation();
  if (action === 'discard-annotation') return closeAnnotation(true);
  if (action === 'edit-comment') {
    const d = draft(currentItem().conversation_id); const index = Number(element.dataset.index); const c = d.comments?.[index];
    const target = data.items.find(i => i.id === c?.artifact_id);
    if (!c || annotationForAsset(d, target?.id) || currentVersion(currentItem()).revision !== currentItem().latest_revision || c.revision !== target?.latest_revision) return;
    if (!parkAnnotation(d).ok) return;
    state.item = target.id; state.revision = c.revision; state.compare = false;
    return annotate(c.kind, c.anchor, index);
  }
  if (action === 'remove-comment') {
    const item = currentItem(); const d = draft(item.conversation_id); const index = Number(element.dataset.index); const c = d.comments?.[index];
    const editing = [d.annotation, ...Object.values(d.parked_annotations ?? {})].some(a => a?.edit_index !== undefined);
    if (!c || annotationForAsset(d, item.id) || editing || currentVersion(item).revision !== item.latest_revision || c.revision !== data.items.find(i => i.id === c.artifact_id)?.latest_revision) return;
    d.comments.splice(index, 1); state.activeComment = -1;
    await persistDraft(item.conversation_id); renderReview(); return;
  }
  if (action === 'mark-region') { if (currentVersion(currentItem()).revision !== currentItem().latest_revision || annotationForAsset(draft(currentItem().conversation_id), state.item)) return; state.marking = !state.marking; renderReview(); return; }
  if (action === 'image-comment') return annotate('comment', { type: 'region', x: 0, y: 0, width: 1, height: 1 });
  if (action === 'compare') { state.compare = !state.compare; renderReview(); return; }
  if (action === 'latest') { const item = currentItem(); const d = draft(item.conversation_id); if (!parkAnnotation(d).ok) return; if (d.comments?.length) { toast('Your comments stay pinned to the earlier version. Review them before sending.'); } state.revision = item.latest_revision; state.compare = false; await persistDraft(item.conversation_id); renderReview(); return; }
  if (action === 'reset-review') { const item = currentItem(); data.drafts[item.conversation_id] = { comments: [], note: '', pins: [] }; await persistDraft(item.conversation_id); return reviewItem(item.id); }
  if (action === 'submit-review') return submitReview(element?.dataset.decision);
  if (action === 'answer-review') return submitReview();
}

async function guarded(callback) {
  if (busy) return;
  busy = true;
  document.body.setAttribute('aria-busy', 'true');
  try { await callback(); } catch (error) { toast(error.message); } finally { busy = false; document.body.removeAttribute('aria-busy'); if (signalToOpen) queueMicrotask(openNotifiedSignal); }
}

document.addEventListener('click', event => {
  const link = event.target.closest('.signal-body a[data-signal-link]');
  if (link) { event.preventDefault(); void guarded(() => request('/api/links/open', { url: link.href })); return; }
  // Pointer-up owns image placement. Do not turn the trailing click into a pin
  // or activate a pin underneath a completed/canceled drag. Keyboard pins work.
  if (suppressImageClick && event.detail > 0 && event.target.closest('#image-surface')) { event.preventDefault(); return; }
  const element = event.target.closest('[data-action]');
  if (element) { event.preventDefault(); void guarded(() => handle(element.dataset.action, element)); return; }
});
document.addEventListener('submit', event => {
  if (event.target.id === 'start-form') { event.preventDefault(); const form = new FormData(event.target); void guarded(async () => { await request('/api/sessions/start', { workspace: form.get('workspace'), title: form.get('title') }); state.tab = 'connections'; await refresh(true); toast('Claude is connecting.'); }); }
  if (event.target.id === 'reply-form') { event.preventDefault(); void guarded(() => respond({ text: $('#signal-reply').value })); }
  if (event.target.id === 'annotation-form') { event.preventDefault(); void guarded(saveAnnotation); }
});
document.addEventListener('input', event => {
  if (event.target.id === 'signal-reply') {
    const key = `signal_${displayedSignal.id}`; draft(key).message = event.target.value;
    void (saveQuestionText(displayedSignal, event.target.value) ?? persistDraft(key)).catch(() => toast('Draft could not be saved.'));
  }
  if (event.target.id === 'review-answer') {
    const id = currentItem().conversation_id; const d = draft(id);
    if (d.pending?.uncertain) return;
    d.request_answer = event.target.value;
    const source = data.signals.find(s => s.id === d.request?.signal_id);
    const saved = reviewRequestIsCurrent(d.request, source) && saveQuestionText(source, event.target.value);
    void (saved || persistDraft(id)).catch(() => toast('Draft could not be saved.'));
  }
  if (event.target.id === 'review-note') { const id = currentItem().conversation_id; draft(id).note = event.target.value; void persistDraft(id).then(() => { if ($('#draft-status')) $('#draft-status').textContent = draft(id).pending?.uncertain ? 'Previous send unconfirmed.' : ''; }).catch(() => toast('Draft could not be saved.')); }
  if (['annotation-text', 'replacement-text'].includes(event.target.id)) {
    const id = currentItem()?.conversation_id; const a = draft(id).annotation; if (!a) return;
    a[event.target.id === 'annotation-text' ? 'text' : 'replacement'] = event.target.value;
    void persistDraft(id).catch(() => toast('Draft could not be saved.'));
  }
  if (event.target.matches('.review-aside textarea')) growCommentFields();
  if (event.target.id === 'library-search') { state.search = event.target.value; renderLibrary(); }
});
document.addEventListener('toggle', event => { if (event.target.id === 'past-sessions' && event.target.isConnected) state.pastSessions = event.target.open; }, true);
document.addEventListener('change', event => {
  if (event.target.matches('input[name="review-choice"]')) { const id = currentItem().conversation_id; draft(id).request_answer = event.target.value; void persistDraft(id).catch(() => toast('Draft could not be saved.')); }
  if (event.target.id === 'review-request') {
    const id = currentItem().conversation_id; const d = draft(id); const source = reviewSources(id).find(s => s.id === event.target.value);
    if (d.pending?.uncertain) { renderReview(); return; }
    const saved = source && data.drafts[`signal_${source.id}`];
    d.request = source ? captureReviewRequest(source) : null;
    d.request_answer = source?.interaction?.response_type === 'text' && reviewRequestIsCurrent(saved?.request, source) ? saved.message ?? '' : '';
    if (source?.review_request && !(d.comments?.length || d.note?.trim() || d.annotation || Object.keys(d.parked_annotations ?? {}).length)) {
      d.pins = structuredClone(source.review_request.artifacts);
      if (!d.pins.some(p => p.artifact_id === state.item)) { const target = data.items.find(i => i.id === d.pins[0].artifact_id); if (target) { state.item = target.id; state.revision = target.latest_revision; state.compare = false; } }
    }
    void persistDraft(id).then(() => { renderReview(); $('#review-request')?.closest('.select-control')?.querySelector('.select-trigger')?.focus({ preventScroll: true }); }).catch(() => toast('Draft could not be saved.'));
  }
  if (event.target.id === 'version-picker') {
    const d = draft(currentItem().conversation_id);
    if (!parkAnnotation(d).ok) return;
    state.revision = Number(event.target.value); state.compare = false; state.marking = false;
    void persistDraft(currentItem().conversation_id).catch(() => toast('Draft could not be saved.'));
    renderReview(); present($('#canvas')); $('#version-picker')?.closest('.select-control')?.querySelector('.select-trigger')?.focus({ preventScroll: true });
  } });
$('#dialog').addEventListener('close', () => {
  closeControls(); selected = null; restoreFocus(modalRestore);
  // WebKit's native text editor can retain first responder after a modal closes.
  // Returning it to this owned view keeps plain Enter working without a click.
  void request('/api/focus', {}).catch(() => {});
});
document.addEventListener('keydown', event => {
  const modifier = event.metaKey || event.ctrlKey;
  if (modifier && event.key === ',') { event.preventDefault(); void guarded(() => handle('settings')); return; }
  if (event.defaultPrevented || controlsOpen()) return;
  const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || !!document.activeElement?.closest('.select-control, .app-menu');
  if ($('#dialog').open) {
    if (event.key === 'Escape') { event.preventDefault(); closeDialog(); return; }
    if (modifier && event.key === 'Enter') { event.preventDefault(); $('#dialog form')?.requestSubmit(); }
    return;
  }
  if (state.tab === 'review') {
    const a = draft(currentItem()?.conversation_id).annotation;
    if (event.key === 'Escape' && !$('#selection-tools').hidden) { event.preventDefault(); $('#selection-tools').hidden = true; selected = null; restoreFocus($('#canvas')); return; }
    if (event.key === 'Escape' && a && !a.collapsed) { event.preventDefault(); void guarded(() => closeAnnotation()); return; }
    if (event.key === 'Escape' && (regionStart || state.marking)) { event.preventDefault(); cancelImageGesture(); state.marking = false; renderReview(); restoreFocus($('#canvas')); return; }
    if (a && !a.collapsed && event.key === 'Enter' && !event.shiftKey && !event.isComposing && ((event.target.matches('#annotation-form textarea')) || modifier)) {
      event.preventDefault(); $('#annotation-form')?.requestSubmit(); return;
    }
  }
  if (modifier && event.key.toLowerCase() === 'n') { event.preventDefault(); void guarded(() => compose()); return; }
  if (modifier && event.key.toLowerCase() === 'k') { event.preventDefault(); void guarded(() => handle('inbox')); return; }
  if (event.key === 'Escape') { event.preventDefault(); void guarded(() => state.tab === 'review' ? handle('back') : handle('hide')); return; }
  if (state.tab === 'review' && modifier && event.key === 'Enter') { event.preventDefault(); const question = draft(currentItem()?.conversation_id).request?.structured === false; void guarded(() => submitReview(question ? undefined : event.shiftKey ? 'reject' : 'approve')); return; }
  if (editing || state.tab !== 'inbox') return;
  const s = displayedSignal;
  if (modifier && event.key === 'ArrowLeft') { event.preventDefault(); void guarded(() => handle('aside')); return; }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); void guarded(() => handle(event.key === 'ArrowLeft' ? 'previous' : 'next')); return; }
  const choices = s?.interaction?.response_type === 'single_choice' ? s.interaction.actions : [];
  if (choices.length && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); state.option = (state.option + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length; renderInbox(); return; }
  if (choices.length && /^[1-8]$/.test(event.key) && choices[Number(event.key) - 1]) { event.preventDefault(); void guarded(() => respond({ option_id: choices[Number(event.key) - 1].id })); return; }
  if (event.key === 'Enter' && document.activeElement?.matches('button:not(.option), a, summary')) return;
  if (event.key === 'Enter') { event.preventDefault(); void guarded(() => choices.length ? respond({ option_id: choices[state.option].id }) : !s ? handle(state.later ? 'inbox' : 'hide') : s.review_request ? reviewItem(itemsFor(s.conversation_id).find(i => s.review_request.artifacts.some(p => p.artifact_id === i.id))?.id) : s.interaction?.mode !== 'required' ? handle('done') : $('#signal-reply')?.focus()); return; }
  if (event.key.toLowerCase() === 'r' && s) { event.preventDefault(); void guarded(() => handle('reply')); }
});

document.addEventListener('mouseup', event => {
  if (state.tab !== 'review' || $('#dialog').open || event.target.closest('#selection-tools')) return;
  if (currentVersion(currentItem())?.revision !== currentItem()?.latest_revision) { $('#selection-tools').hidden = true; return; }
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) { $('#selection-tools').hidden = true; return; }
  const range = selection.getRangeAt(0);
  const start = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement)?.closest('[data-block]');
  const end = (range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement)?.closest('[data-block]');
  if (!start || start !== end) { $('#selection-tools').hidden = true; return; }
  const prefix = document.createRange(); prefix.selectNodeContents(start); prefix.setEnd(range.startContainer, range.startOffset);
  const from = prefix.toString().length; const quote = range.toString();
  if (!quote.trim()) return;
  selected = { type: 'text', block_id: start.dataset.block, start: from, end: from + quote.length, quote };
  const rect = range.getBoundingClientRect(); const tools = $('#selection-tools');
  tools.hidden = false; tools.style.left = `${Math.min(window.innerWidth - 205, Math.max(10, rect.left))}px`; tools.style.top = `${Math.max(65, rect.top - 41)}px`;
});

function cancelImageGesture() {
  const active = regionStart;
  if (!active) return;
  regionStart = null;
  suppressImageClick = true;
  active.surface.querySelector('#drawing-region')?.setAttribute('hidden', '');
  if (active.surface.hasPointerCapture(active.gesture.pointerId)) active.surface.releasePointerCapture(active.gesture.pointerId);
}

function imageGestureIsCurrent(active) {
  const item = currentItem();
  return active.surface.isConnected && state.tab === 'review' && item?.id === active.itemId
    && currentVersion(item)?.revision === active.revision && item.latest_revision === active.revision
    && !annotationForAsset(draft(item.conversation_id), item.id);
}

document.addEventListener('pointerdown', event => {
  if (regionStart) return;
  suppressImageClick = false;
  const surface = event.target.closest('#image-surface');
  const item = currentItem(); const version = currentVersion(item);
  if (!surface || busy || state.tab !== 'review' || event.target.closest('[data-action]') || !item
    || version?.revision !== item.latest_revision || draft(item.conversation_id).pending?.uncertain || annotationForAsset(draft(item.conversation_id), item.id)) return;
  const gesture = createImageGesture($('#artifact-image').getBoundingClientRect(), event, { regionOnly: state.marking });
  if (!gesture) return;
  regionStart = { surface, gesture, itemId: item.id, revision: version.revision };
  surface.setPointerCapture(event.pointerId); event.preventDefault();
});
document.addEventListener('pointermove', event => {
  if (!regionStart) return;
  const active = regionStart;
  if (!imageGestureIsCurrent(active)) { cancelImageGesture(); return; }
  const result = active.gesture.move(event);
  if (!result) return;
  const mark = active.surface.querySelector('#drawing-region'); const a = result.anchor;
  mark.hidden = !result.dragging; mark.style.left = `${a.x * 100}%`; mark.style.top = `${a.y * 100}%`; mark.style.width = `${a.width * 100}%`; mark.style.height = `${a.height * 100}%`;
});
document.addEventListener('pointerup', event => {
  if (!regionStart || event.pointerId !== regionStart.gesture.pointerId) return;
  const active = regionStart;
  const current = imageGestureIsCurrent(active);
  const result = active.gesture.finish(event);
  cancelImageGesture();
  if (current && result) annotate('comment', result.anchor);
});
document.addEventListener('pointercancel', event => {
  if (event.pointerId === regionStart?.gesture.pointerId) cancelImageGesture();
});
document.addEventListener('lostpointercapture', event => {
  if (event.pointerId === regionStart?.gesture.pointerId && event.target === regionStart.surface) cancelImageGesture();
});

await initPreferences();
const fit = fitCompanion({ main: $('#main'), header: $('#header'), dialog: $('#dialog'), request });
await refresh(true).catch(error => { $('#main').innerHTML = `<section class="empty"><h1>A little disconnected.</h1><p>${esc(error.message)}</p><button class="primary" data-action="reload">Try again</button></section>`; });
setInterval(() => { void refresh().catch(() => {}); }, 1800);
