const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const titleCase = value => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, char => char.toUpperCase());
const names = { electric: 'Electric', infrared: 'Infrared', afterhours: 'After hours' };
const moods = { electric: 'Current direction · near black / acid', infrared: 'Experimental · near black / coral', afterhours: 'Experimental · near black / lavender' };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let catalog, byPath, theme = 'electric', toastTimer;
const base = new URL('./', location.href);
const endpoint = path => new URL(path, base).href;
const themeQuery = new URL(location.href).searchParams.get('theme');
if (Object.hasOwn(names, themeQuery)) theme = themeQuery;

function announce(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2300);
}
async function copy(text, message = 'CSS variable copied') {
  try {
    await navigator.clipboard.writeText(text);
    announce(message);
  } catch {
    $('#copy-text').value = text;
    $('#copy-dialog').showModal();
    $('#copy-text').focus();
    $('#copy-text').select();
  }
}
$('#close-copy').addEventListener('click', () => $('#copy-dialog').close());
$('#share-site').addEventListener('click', () => copy(location.href, 'Reference link copied'));
const agentBrief = () => `Use Somae Design v0.2 as the visual reference for this implementation.\n\nRead the usage guide: ${endpoint('agent-guide.md')}\nRead the canonical DTCG tokens: ${endpoint('tokens.json')}\nBrowse the visual guide: ${base.href}\nUse the approved Wave mark: ${endpoint('assets/wave.svg')}\n\nUse named semantic tokens and the selected material. Preserve the message → signal model, purposeful motion, reduced-motion support, and accessible states. Experimental materials and proposed values are labeled. Convert CSS-ready values explicitly for native platforms.`;
$('#copy-agent-prompt').addEventListener('click', () => copy(agentBrief(), 'Agent brief copied'));
$('#agent-snippet').textContent = `// One source. Every material.\nconst tokens = await fetch(\n  "${endpoint('tokens.json')}"\n).then(r => r.json());\n\n// Usage and interaction rules\n${endpoint('agent-guide.md')}`;

async function loadWave() {
  const response = await fetch('./assets/wave.svg');
  if (!response.ok) throw new Error('Wave asset could not load');
  const svg = new DOMParser().parseFromString(await response.text(), 'image/svg+xml').documentElement;
  if (svg.localName !== 'svg') throw new Error('Invalid Wave asset');
  svg.querySelector('title')?.remove();
  svg.removeAttribute('aria-labelledby');
  svg.removeAttribute('role');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const slot of $$('[data-wave]')) slot.replaceChildren(svg.cloneNode(true));
}
function token(path) { return byPath?.get(path); }
function setTheme(next, updateURL = true) {
  theme = Object.hasOwn(names, next) ? next : 'electric';
  document.documentElement.dataset.theme = theme;
  for (const button of $$('[data-theme-choice]')) button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme));
  $('#theme-status').textContent = theme === 'electric' ? 'Current direction' : 'Experimental material';
  $('#material-name').textContent = names[theme];
  $('#material-note').textContent = moods[theme];
  if (catalog) { renderColors(); renderTokens(); }
  if (updateURL) {
    const url = new URL(location.href);
    url.searchParams.set('theme', theme);
    history.replaceState(null, '', url);
  }
}
for (const button of $$('[data-theme-choice]')) button.addEventListener('click', () => setTheme(button.dataset.themeChoice));

function swatchInk(value) {
  const alpha = value.alpha ?? 1;
  const paper = [243, 242, 237];
  const hex = '#' + value.components.map((channel, index) => Math.round(channel * 255 * alpha + paper[index] * (1 - alpha)).toString(16).padStart(2, '0')).join('');
  const luminance = color => {
    const channels = color.replace('#','').match(/.{2}/g).slice(0,3).map(value => parseInt(value,16)/255).map(value => value <= .04045 ? value/12.92 : ((value+.055)/1.055)**2.4);
    return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
  };
  const background = luminance(hex);
  const dark = luminance('#242820');
  const darkContrast = (Math.max(background,dark)+.05)/(Math.min(background,dark)+.05);
  const lightContrast = 1.05/(background+.05);
  return darkContrast > lightContrast ? '#242820' : '#ffffff';
}
function renderColors() {
  const order = ['accent','panel','surface','ink','stage','stageInk','surfaceHover','line','muted','faint','accentInk','accentDim','focus','selection','annotation','annotationFill'];
  $('#color-grid').innerHTML = order.map(role => {
    const item = token(`color.${theme}.${role}`);
    return `<button class="color-swatch" data-copy="var(${escapeHTML(item.cssVariable)})" aria-label="Copy ${escapeHTML(item.cssVariable)}" title="${escapeHTML(item.description)}"><span class="color-chip" style="background:${item.cssValue};color:${swatchInk(item.value)}"><span>${item.cssValue.toUpperCase()}</span><span aria-hidden="true">↗</span></span><span class="swatch-name">${titleCase(role)}</span><span class="swatch-role">${escapeHTML(item.cssVariable.replace('--somae-',''))}</span></button>`;
  }).join('');
}
function renderScales() {
  const typeExamples = [['font.size.review','A clear point of view.'],['font.size.decision','A little more space?'],['font.size.title','Here when you need it.'],['font.size.body','Make room for a thought.'],['font.size.control','Send a message'],['font.size.label','01 / 04 · WAITING FOR YOU']];
  $('#type-scale').innerHTML = typeExamples.map(([path,example]) => {
    const item=token(path);
    return `<div class="type-row"><code>${path.replace('font.size.','')}</code><span style="font-size:${item.cssValue};--sample-size:${item.cssValue}">${example}</span><small>${item.cssValue}</small></div>`;
  }).join('');
  $('#space-scale').innerHTML = [4,8,12,16,20,24,32].map(size => {
    const item=token(`space.${size}`);
    return `<div class="space-item"><code>${item.path}</code><div class="space-bar" style="width:calc(${item.cssValue} * 4)"></div><span>${item.cssValue}</span></div>`;
  }).join('');
  $('#radius-grid').innerHTML = ['small','action','beacon','dialog','panel','appIcon'].map(name => {
    const item=token(`radius.${name}`);
    return `<div class="radius-card"><div style="border-radius:${item.cssValue}">${item.cssValue}</div><code>${titleCase(name)}</code></div>`;
  }).join('');
  $('#motion-values').innerHTML = ['summon','dismiss','resize'].map(name => `<div class="motion-value"><span>${titleCase(name)}</span><code>${token(`motion.duration.${name}`).cssValue}</code></div>`).join('');
  $('#motion-curve').textContent = token('motion.easing.standard').cssValue;
}
function renderTokens() {
  const query = $('#token-search').value.trim().toLowerCase();
  const category = $('#token-category').value;
  const active = catalog.tokens.filter(item => !item.theme || item.theme === theme);
  const filtered = active.filter(item => (category === 'all' || item.path.split('.')[0] === category) && `${item.path} ${item.cssVariable} ${item.cssValue} ${item.description}`.toLowerCase().includes(query));
  $('#token-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'token' : 'tokens'} shown · ${names[theme]} + shared values · ${catalog.tokens.length} across all materials`;
  $('#token-rows').innerHTML = filtered.length ? filtered.map(item => `<tr><td><code>${escapeHTML(item.path)}</code><p>${escapeHTML(item.description)}</p>${item.status === 'proposed' || item.status === 'experimental' ? `<span class="token-status">${item.status === 'proposed' ? 'NORMALIZED / PROPOSED' : 'EXPERIMENTAL'}</span>` : ''}</td><td><code>${escapeHTML(item.cssValue)}</code></td><td><button class="copy-token" data-copy="var(${escapeHTML(item.cssVariable)})" aria-label="Copy ${escapeHTML(item.cssVariable)}">Copy</button></td></tr>`).join('') : '<tr><td colspan="3" class="empty-tokens">No matching tokens. Try “accent”, “space”, or “summon”.</td></tr>';
}
$('#token-search').addEventListener('input', () => { if(catalog) renderTokens(); });
$('#token-category').addEventListener('change', () => { if(catalog) renderTokens(); });
document.addEventListener('click', event => {
  const button = event.target.closest('[data-copy]');
  if (button) copy(button.dataset.copy);
});
$('#type-input').addEventListener('input', event => { $('#type-preview').textContent = event.target.value || 'A thought, worth your time.'; });

let approved = false;
function showSample(sent) {
  approved = sent;
  $('#sample-title').textContent = sent ? 'Back to your agent.' : 'A little more space?';
  $('#sample-copy').textContent = sent ? 'Your choice is clear. The agent can carry on.' : 'The new direction gives the idea room to land.';
  $('#sample-approve').innerHTML = sent ? 'Response sent <span aria-hidden="true">✓</span>' : 'Use this direction <span aria-hidden="true">↗</span>';
  $('#sample-approve').disabled = sent;
  $('#sample-reset').textContent = sent ? 'Undo response' : 'Keep exploring';
  if(sent) announce('Demo response recorded. Nothing was sent.');
}
$('#sample-approve').addEventListener('click', () => showSample(true));
$('#sample-reset').addEventListener('click', () => {
  if(approved)showSample(false);
  else { $('#sample-copy').textContent = 'A second direction could make the difference. Keep the question open.'; announce('Demo feedback added'); }
});
$('#toggle-canvas').addEventListener('click', () => {
  const open = $('#sample-canvas').hidden;
  $('#sample-canvas').hidden = !open;
  $('#toggle-canvas').setAttribute('aria-expanded', String(open));
  $('#toggle-canvas').innerHTML = `${open ? 'Close the preview' : 'Open the preview'} <span aria-hidden="true">${open ? '↙' : '↗'}</span>`;
});
for(const button of $$('[data-demo-feedback]')) button.addEventListener('click', () => { $('#demo-feedback').textContent = button.dataset.demoFeedback; });
$('#reply-example').addEventListener('input', event => { $('#reply-example-send').disabled = !event.target.value.trim(); });
function sendReplyDemo() {
  if(!$('#reply-example').value.trim())return;
  $('#reply-feedback').textContent = 'Reply previewed. Nothing was sent.';
  $('#reply-example').value = '';
  $('#reply-example-send').disabled = true;
}
$('#reply-example-send').addEventListener('click', sendReplyDemo);
$('#reply-example').addEventListener('keydown', event => { if(event.key === 'Enter'){event.preventDefault();sendReplyDemo();} });

let motionGeneration = 0, expanded = false;
const panel = $('#motion-panel');
const reduce = () => reducedMotion.matches || $('#reduce-motion').checked;
function duration(name) { const item = token(`motion.duration.${name}`); return item ? item.value.value * (item.value.unit === 's' ? 1000 : 1) : 0; }
function stopMotion() { motionGeneration++; panel.getAnimations().forEach(animation => animation.cancel()); }
function playMotion(frames, name) {
  if(reduce() || !byPath) return null;
  return panel.animate(frames,{duration:duration(name),easing:token('motion.easing.standard').cssValue});
}
function readout(name) { $('#motion-readout').textContent = `${titleCase(name)} · ${reduce() ? 'immediate / reduced motion' : token(`motion.duration.${name}`)?.cssValue || 'immediate'}`; }
function summon() {
  stopMotion(); panel.hidden = false; $('#motion-beacon').hidden = true;
  playMotion([{opacity:0,transform:'translateY(12px) scale(.975)',clipPath:'inset(44% 3% round 12px)'},{opacity:1,transform:'none',clipPath:'inset(0% 0% round 12px)'}],'summon');
  readout('summon');
}
function dismiss() {
  if(panel.hidden){readout('dismiss');return;}
  stopMotion(); const generation = motionGeneration;
  $('#motion-beacon').hidden = false;
  const animation=playMotion([{opacity:1,transform:'none',clipPath:'inset(0% 0% round 12px)'},{opacity:0,transform:'translateY(-8px) scale(.98)',clipPath:'inset(44% 3% round 12px)'}],'dismiss');
  if(animation)animation.finished.then(()=>{if(generation===motionGeneration)panel.hidden=true;}).catch(()=>{});
  else panel.hidden=true;
  readout('dismiss');
}
function resize() {
  stopMotion(); panel.hidden=false; $('#motion-beacon').hidden=true;
  const before=panel.getBoundingClientRect(); expanded=!expanded; $('#motion-extra').hidden=!expanded;
  const after=panel.getBoundingClientRect();
  playMotion([{height:`${before.height}px`},{height:`${after.height}px`}],'resize');
  readout('resize');
}
$('#motion-summon').addEventListener('click',summon);
$('#motion-beacon').addEventListener('click',summon);
$('#motion-dismiss').addEventListener('click',dismiss);
$('#motion-resize').addEventListener('click',resize);
function enforceMotionPreference() {
  if(reduce())panel.getAnimations().forEach(animation=>animation.finish());
  $('#motion-readout').textContent = reduce() ? 'Reduced motion · changes are immediate.' : 'Choose a gesture to play it.';
  $('#reduce-motion').checked = reducedMotion.matches || $('#reduce-motion').checked;
  $('#reduce-motion').disabled = reducedMotion.matches;
}
$('#reduce-motion').addEventListener('change',enforceMotionPreference);
reducedMotion.addEventListener('change',enforceMotionPreference);
enforceMotionPreference();

const sections = $$('.observed-section');
const navigation = $$('.sidebar nav a');
function updateSection() {
  const target = [...sections].reverse().find(section => section.getBoundingClientRect().top <= 180) || sections[0];
  for(const link of navigation){if(link.hash === `#${target.id}`)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}
}
let scrollPending = false;
addEventListener('scroll',()=>{if(!scrollPending){scrollPending=true;requestAnimationFrame(()=>{updateSection();scrollPending=false;});}},{passive:true});
updateSection();
try {
  const results = await Promise.all([fetch('./catalog.json'),loadWave()]);
  if(!results[0].ok)throw new Error('Token catalog could not load');
  catalog = await results[0].json();
  byPath = new Map(catalog.tokens.map(item=>[item.path,item]));
  $('#token-total').textContent = catalog.tokens.length;
  const categories=new Set(catalog.tokens.map(item=>item.path.split('.')[0]));
  const existing=new Set([...$('#token-category').options].map(option=>option.value));
  for(const category of categories)if(!existing.has(category))$('#token-category').add(new Option(titleCase(category),category));
  setTheme(theme,false);renderScales();
  document.documentElement.dataset.ready='true';
} catch(error) {
  $('#color-grid').textContent='The interactive catalog could not load. The JSON and usage guide are available below.';
  $('#token-count').textContent='Catalog unavailable. Open the complete JSON below.';
  console.error(error);
}
