import { animateLayout, enterContent, confirm, pressFeedback } from './motion.js';

const $ = s => document.querySelector(s);
const all = s => [...document.querySelectorAll(s)];
const escape = v => String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
  back:'<path d="m14 6-6 6 6 6"/>', next:'<path d="m10 6 6 6-6 6"/>',
  up:'<path d="M12 19V5m-5 5 5-5 5 5"/>', down:'<path d="m6 9 6 6 6-6"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>', check:'<path d="m5 12 4 4L19 6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', notes:'<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/>',
  preview:'<rect x="3" y="4" width="18" height="16" rx="4"/><path d="M3 9h18M8 9v11"/>',
  globe:'<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c5 4 5 12 0 16-5-4-5-12 0-16"/>',
  spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  activity:'<path d="M4 15V9M9 19V5M14 16V8M19 13v-2"/>',
  person:'<circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  leaf:'<path d="M19 4C7 3 3 9 6 15c5 6 14 1 13-11ZM6 20 15 9"/>',
  link:'<path d="m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  clock:'<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  pause:'<path d="M9 5v14M15 5v14"/>', download:'<path d="M12 3v12m-4-4 4 4 4-4M5 17v4h14v-4"/>'
};
const icon = n => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[n]||paths.spark}</svg>`;
const seed = '<svg class="seed" viewBox="0 0 30 30" aria-hidden="true"><path d="M14 3C5 2 1 9 5 15c3 4 7 3 10-1 4-5 5-10-1-11ZM16 27c9 1 13-6 9-12-3-4-7-3-10 1-4 5-5 10 1 11Z"/></svg>';
const agents = {
  roam:{name:'Roam',symbol:'globe',tone:'roam',scope:'Ask questions and request booking approvals'},
  claude:{name:'Claude Code',symbol:'spark',tone:'claude',scope:'Ask questions and submit draft reviews'},
  codex:{name:'Codex',symbol:'notes',tone:'codex',scope:'Request decisions and publish session activity'}
};
const avatar = a => `<span class="avatar ${agents[a].tone}">${icon(agents[a].symbol)}</span>`;
const requests = [
  {id:'stay',agent:'roam',project:'Austin trip',type:'approval',title:'A place to land in Austin.',hint:'Approve a stay · $1,248',age:'Just now',message:'I found a quiet spot near your meetings. A courtyard, good coffee, and room to slow down.',context:'Your brief: November 7–10, three nights, under $1,600, walkable, with free cancellation.'},
  {id:'hello',agent:'claude',project:'Somae',type:'review',title:'Does this sound like us?',hint:'Review the first hello',age:'12 min',message:'The first-run copy is ready. Short, welcoming, and built around one idea: your attention is yours.',context:'You asked for three short screens that make agent requests feel simple and human.'},
  {id:'weekend',agent:'roam',project:'Personal',type:'question',title:'What would feel good this weekend?',hint:'A sentence is plenty',age:'24 min',message:'I can leave the plans loose. What are you in the mood for?',suggestions:['A little time outside','A slow day at home','Somewhere new'],context:'You asked me to find a little room around this week. No bookings or commitments without your go-ahead.'},
  {id:'runs',agent:'codex',project:'Somae',type:'choice',title:'Give agent runs their own home?',hint:'Choose an approach',age:'35 min',message:'I’d keep execution history separate from sessions. It gives retries and events room to grow.',options:['Create an agent_runs table','Extend the sessions table'],context:'A separate table supports multiple runs and retries. Extending sessions is a smaller change today. I’ll draft the migration before changing data.'}
];
const stays = {
  carpenter:{name:'Carpenter Hotel',price:'$1,248',detail:'A quiet courtyard',area:'East Austin'},
  line:{name:'The LINE Austin',price:'$1,486',detail:'Wake up by the water',area:'Downtown'},
  san:{name:'Hotel San José',price:'$1,362',detail:'A garden off South Congress',area:'South Congress'}
};
const storageKey = 'somae-gather-v1';
let stored={};try{stored=JSON.parse(localStorage.getItem(storageKey)||'{}');}catch{}
const state={theme:'mint',answers:{},later:[],notes:{},context:{},paused:[],allowed:false,hotel:'carpenter',...stored};
if(!['mint','iris','sand'].includes(state.theme))state.theme='mint';
if(!stays[state.hotel])state.hotel='carpenter';
let route='needs',selected='stay',filter='waiting',opened=true,previewOpen=false,noteMode='',rendered='',toastTimer;
const drafts=new Map();
const draftModes=new Map();
const contextDrafts=new Map();
const on=(selector,fn)=>{const el=$(selector);if(el)el.onclick=fn;};
const save=()=>{try{localStorage.setItem(storageKey,JSON.stringify(state));}catch{}};
const current=()=>requests.find(r=>r.id===selected)||requests[0];
const pending=()=>requests.filter(r=>!state.answers[r.id]&&!state.later.includes(r.id));
function notify(text){$('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2600);}
function go(path){if(location.hash===`#${path}`)readRoute();else location.hash=path;}
function setOpen(value){
  opened=value;
  $('#gather-shell').classList.toggle('closed',!value);
  $('#window-wrap').inert=!value;
  $('#window-wrap').setAttribute('aria-hidden',String(!value));
  renderTray();
  if(!value)$('#open-tray').focus({preventScroll:true});
  else $('#surface h1')?.focus({preventScroll:true});
}
function renderTray(){
  const n=pending().length;
  $('#tray').innerHTML=`<button class="tray-brand" id="open-tray" aria-label="${opened?'Somae home':'Open Somae'}" aria-expanded="${opened}">${seed}<span>${opened?'':n?`${n} need you`:'All quiet'}</span></button>${opened?`<div class="tray-tabs"><button data-nav="needs" class="${['needs','request'].includes(route)?'active':''}" aria-pressed="${['needs','request'].includes(route)}">Needs you ${n?`<span class="tray-count">${n}</span>`:''}</button><button data-nav="activity" class="${route==='activity'?'active':''}" aria-pressed="${route==='activity'}">In motion</button><button data-nav="you" class="${['you','context','connections','preferences'].includes(route)?'active':''}" aria-pressed="${['you','context','connections','preferences'].includes(route)}">You</button></div><button class="icon-button tuck" id="tuck" aria-label="Tuck away Somae">${icon('down')}</button>`:`<button class="tray-open" id="expand-tray" aria-label="Open attention tray">Open ${icon('up')}</button>`}`;
  $('#open-tray').onclick=()=>opened?go('needs'):setOpen(true);
  on('#expand-tray',()=>setOpen(true));
  on('#tuck',()=>setOpen(false));
  all('[data-nav]').forEach(b=>b.onclick=()=>go(b.dataset.nav));
}
function pageHead(title,subtitle,back=''){
  return `<header class="page-head">${back?`<button class="back-button" data-route="${back}">${icon('back')} Back</button>`:''}<h1 tabindex="-1">${title}</h1>${subtitle?`<p>${subtitle}</p>`:''}</header>`;
}
function renderNeeds(){
  const list=filter==='answered'?requests.filter(r=>state.answers[r.id]):filter==='later'?requests.filter(r=>state.later.includes(r.id)):pending();
  const n=pending().length;
  const title=filter==='waiting'?(n?'A moment for you.':'You’re all caught up.'):filter==='later'?'On your own time.':'Back in motion.';
  const subtitle=filter==='waiting'?(n?`${n} small moments. Your agents have the rest.`:'Your agents have it from here.'):filter==='later'?'A few things you chose to come back to.':'The decisions you’ve already made.';
  const hint=r=>state.answers[r.id]?'Answered':r.id==='stay'?`Approve a stay · ${stays[state.hotel].price}`:r.hint;
  return pageHead(title,subtitle)+`<div class="queue-controls" role="group" aria-label="Request filter">${[['waiting','Now'],['later','Later'],['answered','Answered']].map(([id,label])=>`<button data-filter="${id}" class="${filter===id?'active':''}" aria-pressed="${filter===id}">${label}${id==='later'&&state.later.length?` <span>${state.later.length}</span>`:''}</button>`).join('')}</div><div class="queue">${list.length?list.map(r=>`<button class="moment-row" data-route="request/${r.id}">${avatar(r.agent)}<span class="moment-copy"><strong>${r.title}</strong><small>${agents[r.agent].name} · ${r.project}</small><small class="moment-mobile-hint">${hint(r)}</small></span><span class="moment-hint">${hint(r)}</span>${icon('next')}</button>`).join(''):`<div class="empty">${seed}<h2>${filter==='waiting'?'A little quiet.':'Nothing here yet.'}</h2><p>${filter==='waiting'?'Take it with you. We’ll be here.':'Your moments will collect here.'}</p>${filter==='waiting'?'<button class="button" id="replay">Replay the moments</button>':''}</div>`}</div><div class="queue-foot"><button class="text-button" data-route="activity">See what’s moving ${icon('next')}</button></div>`;
}
function noteForm(r){
  const mode=r.type==='question'?'reply':noteMode;
  if(!mode)return '';
  const placeholder=mode==='change'?'What would you change?':mode==='reply'?'A sentence is plenty…':'Add a little context…';
  return `<form class="note-form" id="note-form"><label class="sr-only" for="reply">${mode==='reply'?'Your reply':'Your note'}</label><textarea id="reply" rows="2" placeholder="${placeholder}">${escape(drafts.get(r.id)||'')}</textarea><button type="submit" class="note-send" id="note-send" aria-label="${mode==='change'?'Send changes':mode==='reply'?'Send reply':'Add note'}" disabled>${icon('up')}</button></form>${mode==='change'?'<p class="form-caption">Sending this asks the agent to revise the draft.</p>':''}`;
}
function decision(r){
  const answer=state.answers[r.id];
  if(answer)return `<div class="receipt"><span class="receipt-check">${icon('check')}</span><div><strong>Back to ${agents[r.agent].name}.</strong><p>${escape(answer.text)}</p></div><button class="text-button" id="undo">Undo</button></div><div class="after-answer"><button class="button primary" id="next-moment">${pending().length?'Next moment':'Back to your day'} ${icon('next')}</button><button class="text-button" data-route="needs">View queue</button></div>`;
  let actions='';
  if(r.type==='approval'){
    const stay=stays[state.hotel];
    actions=`<div class="approval-line"><span>Approve ${stay.name}</span><strong>${stay.price}<small> total</small></strong></div><div class="decision-buttons"><button class="button primary" id="approve">Approve stay ${icon('check')}</button><button class="button" id="another">Find another</button></div>`;
  }else if(r.type==='review')actions=`<div class="decision-buttons"><button class="button primary" id="approve">Feels right ${icon('check')}</button><button class="button" id="changes">Suggest a change</button></div>`;
  else if(r.type==='choice')actions=`<div class="choices">${r.options.map((o,i)=>`<button class="choice" data-choice="${i}"><span class="choice-number">${i+1}</span><span>${o}${i===0?'<small>Recommended</small>':''}</span>${icon('next')}</button>`).join('')}</div>`;
  else actions=`<div class="suggestions">${r.suggestions.map(s=>`<button data-suggestion="${escape(s)}">${s}</button>`).join('')}</div>`;
  return actions+`<div id="note-slot">${noteForm(r)}</div><div class="optional-actions">${r.type!=='question'?`<button class="text-button" id="add-note">${icon(noteMode?'close':'plus')} ${noteMode?(noteMode==='change'?'Close changes':'Close note'):drafts.get(r.id)?.trim()?(draftModes.get(r.id)==='change'?'Draft changes':'Draft note'):'Add a note'}</button>`:'<span></span>'}<button class="text-button" id="later">${icon('clock')} Later</button></div>`;
}
function preview(r){
  if(r.type==='approval')return `<div class="preview-control"><button class="text-button" id="toggle-preview" aria-expanded="${previewOpen}" aria-controls="request-preview">${icon('preview')} ${previewOpen?'Close comparison':'Compare three stays'} ${icon(previewOpen?'close':'next')}</button></div><div id="request-preview" class="rich-preview" ${previewOpen?'':'hidden'}><iframe id="stay-canvas" title="Compare Austin stays" sandbox="allow-scripts" src="/prototypes/gather/canvases/stay.html?hotel=${state.hotel}&theme=${state.theme}&locked=${state.answers[r.id]?1:0}"></iframe></div>`;
  if(r.type==='review')return `<div class="copy-preview"><span class="preview-label">FIRST HELLO · DRAFT 02</span><h3>A little room for you.</h3><p>Your agents can do a lot. Every now and then, they need something only you can give: a decision, a detail, a go-ahead.</p><p>This is where those moments come together.</p><button class="text-button" id="download">${icon('download')} Save draft</button></div>`;
  return '';
}
function staySummary(){
  const h=stays[state.hotel];
  return `<div class="stay-summary" id="stay-summary"><span class="stay-mark">${icon('leaf')}</span><div><strong>${h.name}</strong><small>${h.detail} · ${h.area}</small></div><strong class="stay-price">${h.price}<small>3 nights</small></strong></div><div class="stay-facts"><span>Nov 7–10</span><span>Taxes included</span><span>Free cancellation</span></div>`;
}
function comments(r){return (state.notes[r.id]||[]).map(n=>`<p class="sent-note"><small>You</small>${escape(n)}</p>`).join('');}
function renderRequest(){
  const r=current();
  return `<div class="detail-toolbar"><button class="back-button" data-route="needs">${icon('back')} All moments</button><div><button class="icon-button" id="previous" aria-label="Previous moment" title="Previous · J">${icon('back')}</button><button class="icon-button" id="next" aria-label="Next moment" title="Next · K">${icon('next')}</button></div></div><div class="request-content"><div class="request-origin">${avatar(r.agent)}<span>${agents[r.agent].name}<span> / </span>${r.project}</span></div><h1 class="request-title" tabindex="-1">${r.title}</h1><p class="request-message">${r.message}</p>${r.type==='approval'?staySummary():''}${preview(r)}<details class="request-context"><summary>What led here?</summary><p>${r.context}</p><span class="scope-line">${icon('link')} Connected by you · ${agents[r.agent].scope}</span></details><div id="sent-notes">${comments(r)}</div></div><section class="decision-area" id="decision-area" aria-label="Respond to this moment">${decision(r)}</section>`;
}
function renderActivity(){
  return pageHead('A lot, quietly.','Your agents are moving things along.')+`<div class="activity-list">${[
    ['codex','Building the request loop','Drafting the API contract','runs'],
    ['claude','Finding the right words','Waiting on your first hello','hello'],
    ['roam','A little room in Austin','Waiting on a place to stay','stay']
  ].map(([a,title,sub,id])=>`<div class="activity-row">${avatar(a)}<div><strong>${title}</strong><small>${state.paused.includes(a)?'Access paused · Existing session':state.answers[id]?'Continuing with your input':sub}</small></div><button class="icon-button" data-route="request/${id}" aria-label="Open ${agents[a].name} moment" title="Open moment">${icon('next')}</button></div>`).join('')}</div><div class="quiet-note">${icon('leaf')} Nothing you need to keep open.</div>`;
}
function renderYou(){
  return pageHead('Your little corner.','What agents know. Who can reach you.')+`<div class="profile-summary"><span class="profile-orb">s</span><div><strong>Scott Moss</strong><span>@scott</span></div></div><nav class="space-links">${[['context','notes','Your context','A few useful things'],['connections','link','Connections','Permission, in your hands'],['preferences','spark','Make it yours','Palette & preferences']].map(([id,symbol,title,sub])=>`<button data-route="${id}">${icon(symbol)}<span><strong>${title}</strong><small>${sub}</small></span>${icon('next')}</button>`).join('')}</nav>`;
}
const contextNotes={personal:{title:'How I like things',text:'A little quiet, a little room.\n\nShow me enough to make a decision. Ask before booking or publishing.'},somae:{title:'Somae',text:'A human control plane for agents.\n\nIdentity, permission, attention, and durable requests.\n\nA handle invites a connection. A scoped grant allows interaction.'}};
function renderContext(){
  return pageHead('A little context.','Your notes. Shared on your terms.','you')+`<div class="context-tabs">${Object.entries(contextNotes).map(([id,n])=>`<button data-context="${id}" class="${contextId===id?'active':''}">${n.title}</button>`).join('')}</div><label class="sr-only" for="context-note">${contextNotes[contextId].title}</label><textarea id="context-note" class="context-editor">${escape(contextDrafts.get(contextId)??state.context[contextId]??contextNotes[contextId].text)}</textarea><div class="context-foot"><span>Agents don’t write here automatically.</span><button class="button primary" id="save-context">Save note</button></div>`;
}
let contextId='personal';
function renderConnections(){
  return pageHead('Who’s in your corner.','Every connection starts with your permission.','you')+`<div class="connection-list">${Object.keys(agents).map(a=>`<div class="connection-row">${avatar(a)}<div><strong>${agents[a].name}</strong><small>${state.paused.includes(a)?'Access paused':agents[a].scope}</small></div><button class="text-button" data-pause="${a}">${state.paused.includes(a)?'Resume':'Pause'}</button></div>`).join('')}</div>${state.allowed?'<div class="invitation-quiet">No new invitations.</div>':`<section class="invitation"><span class="eyebrow">A NEW CONNECTION</span><h3>Studio would like to meet you.</h3><p>May I share a layout and ask what you think?</p><label><input type="checkbox" id="grant-review" checked> Send one review</label><button class="button primary" id="allow">Allow once</button><button class="text-button" id="decline">Decline</button></section>`}`;
}
function renderPreferences(){
  return pageHead('Make a little space.','A surface that feels like yours.','you')+`<div class="theme-list">${[['mint','Morning mist'],['iris','Soft iris'],['sand','Warm sand']].map(([id,label])=>`<button class="theme-choice ${state.theme===id?'active':''}" data-theme-choice="${id}" aria-pressed="${state.theme===id}"><span class="swatch" data-theme="${id}"></span><span>${label}</span>${state.theme===id?icon('check'):''}</button>`).join('')}</div><div class="preference-row"><span><strong>Keyboard shortcuts</strong><small>A thought, without leaving your flow.</small></span><button class="text-button" id="show-help">View</button></div><div class="preference-row"><span><strong>Sample moments</strong><small>Start this exploration again.</small></span><button class="text-button" id="reset">Replay</button></div><p class="prototype-note">Every reply and preference stays in this browser.</p>`;
}
function render(direction=1){
  const key=route==='request'?`request/${selected}`:`${route}/${contextId}/${filter}`;
  const same=key===rendered;
  animateLayout($('#window'),()=>{
    if(!same||route!=='request'){
      $('#surface').innerHTML=({needs:renderNeeds,request:renderRequest,activity:renderActivity,you:renderYou,context:renderContext,connections:renderConnections,preferences:renderPreferences}[route]||renderNeeds)();
    }else{
      $('#decision-area').innerHTML=decision(current());
      $('#sent-notes').innerHTML=comments(current());
    }
    $('#gather-shell').classList.toggle('previewing',route==='request'&&previewOpen);
    $('#window').classList.toggle('request-mode',route==='request');
    bind();renderTray();
    const frame=$('#stay-canvas');
    if(frame){
      const sync=()=>{
        frame.contentWindow.postMessage({type:'gather-stay-lock',locked:Boolean(state.answers.stay)},'*');
        frame.contentWindow.postMessage({type:'gather-theme',theme:state.theme},'*');
      };
      frame.onload=sync;sync();
    }
  },{duration:380});
  if(!same){
    enterContent($('#surface'),{direction});
    if(rendered){
      const focus=route==='needs'?document.querySelector(`[data-route="request/${selected}"]`):$('#surface h1');
      (focus||$('#surface h1'))?.focus({preventScroll:true});
    }
  }
  rendered=key;
}
function bind(){
  all('[data-route]').forEach(b=>b.onclick=()=>go(b.dataset.route));
  all('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;render();$(`[data-filter="${filter}"]`)?.focus({preventScroll:true});});
  all('[data-choice]').forEach(b=>b.onclick=()=>answer(current().options[Number(b.dataset.choice)]));
  all('[data-suggestion]').forEach(b=>b.onclick=()=>{const input=$('#reply');input.value=b.dataset.suggestion;input.dispatchEvent(new Event('input'));focusReply();});
  on('#previous',()=>step(-1));
  on('#next',()=>step(1));
  on('#approve',()=>answer(current().type==='approval'?`Approved ${stays[state.hotel].name} · ${stays[state.hotel].price}`:'The first hello feels right.'));
  on('#another',()=>answer('Find another stay.'));
  on('#changes',()=>{noteMode='change';draftModes.set(selected,noteMode);render();focusReply();});
  on('#add-note',()=>{noteMode=noteMode?'':draftModes.get(selected)||'note';if(noteMode)draftModes.set(selected,noteMode);render();if(noteMode)focusReply();else $('#add-note').focus();});
  on('#later',()=>{const r=current();if(!state.later.includes(r.id))state.later.push(r.id);save();filter='waiting';go('needs');notify('Saved for your own time.');});
  on('#undo',()=>{delete state.answers[selected];save();render();$('#approve, [data-choice], #reply')?.focus({preventScroll:true});});
  on('#next-moment',()=>pending().length?step(1):setOpen(false));
  on('#toggle-preview',togglePreview);
  on('#download',()=>{const text=$('.copy-preview').innerText;const url=URL.createObjectURL(new Blob([text],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download='somae-first-hello.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Draft saved.');});
  on('#replay',reset);
  on('#reset',reset);
  all('[data-pause]').forEach(b=>b.onclick=()=>{const id=b.dataset.pause;state.paused=state.paused.includes(id)?state.paused.filter(a=>a!==id):[...state.paused,id];save();render();$(`[data-pause="${id}"]`)?.focus({preventScroll:true});});
  all('[data-context]').forEach(b=>b.onclick=()=>{if($('#context-note'))contextDrafts.set(contextId,$('#context-note').value);contextId=b.dataset.context;render();$(`[data-context="${contextId}"]`)?.focus({preventScroll:true});});
  if($('#context-note'))$('#context-note').oninput=e=>contextDrafts.set(contextId,e.target.value);
  on('#save-context',()=>{state.context[contextId]=$('#context-note').value;contextDrafts.delete(contextId);save();notify('A little context, saved.');});
  on('#allow',()=>{if(!$('#grant-review').checked){notify('Choose a permission first.');return;}state.allowed=true;save();render();notify('Allowed one review in this prototype.');});
  on('#decline',()=>{state.allowed=true;save();render();});
  all('[data-theme-choice]').forEach(b=>b.onclick=()=>{state.theme=b.dataset.themeChoice;applyTheme();save();render();$(`[data-theme-choice="${state.theme}"]`)?.focus({preventScroll:true});});
  on('#show-help',()=>$('#shortcuts').showModal());
  bindReply();
}
function focusReply(){
  $('#reply')?.focus({preventScroll:true});
  if(matchMedia('(max-height:650px)').matches)$('#surface').scrollTop=$('#surface').scrollHeight;
}
function bindReply(){
  const input=$('#reply');if(!input)return;
  const update=()=>{drafts.set(selected,input.value);$('#note-send').disabled=!input.value.trim();input.style.height='auto';input.style.height=Math.min(104,input.scrollHeight)+'px';};
  input.addEventListener('input',update);update();
  $('#note-form').onsubmit=e=>{
    e.preventDefault();const text=input.value.trim();if(!text)return;
    if(current().type==='question')answer(text,false);
    else if(noteMode==='change')answer('Changes requested: '+text,false);
    else{state.notes[selected]=[...(state.notes[selected]||[]),text];drafts.delete(selected);draftModes.delete(selected);noteMode='';save();render();confirm($('.sent-note:last-child'));$('#add-note')?.focus({preventScroll:true});}
  };
}
function answer(text,includeNote=true){
  const note=drafts.get(selected)?.trim();
  if(includeNote&&note)state.notes[selected]=[...(state.notes[selected]||[]),note];
  state.answers[selected]={text,...(current().type==='approval'?{hotel:state.hotel}:{})};state.later=state.later.filter(id=>id!==selected);drafts.delete(selected);draftModes.delete(selected);noteMode='';save();render();confirm($('.receipt'));$('#undo').focus({preventScroll:true});
}
function togglePreview(){
  previewOpen=!previewOpen;
  animateLayout($('#window'),()=>{
    $('#request-preview').hidden=!previewOpen;
    $('#gather-shell').classList.toggle('previewing',previewOpen);
    $('#toggle-preview').setAttribute('aria-expanded',String(previewOpen));
    $('#toggle-preview').innerHTML=icon('preview')+' '+(previewOpen?'Close comparison':'Compare three stays')+' '+icon(previewOpen?'close':'next');
  },{duration:420});
}
function step(direction){
  const list=pending();if(!list.length){go('needs');return;}
  const index=requests.findIndex(r=>r.id===selected);
  for(let offset=1;offset<=requests.length;offset++){
    const next=requests[(index+direction*offset+requests.length*2)%requests.length];
    if(list.some(r=>r.id===next.id)){navigationDirection=direction;go(`request/${next.id}`);return;}
  }
}
let navigationDirection=1;
function readRoute(){
  const [name,id]=location.hash.slice(1).split('/');
  const nextRoute=name==='request'&&requests.some(r=>r.id===id)?'request':['needs','activity','you','context','connections','preferences'].includes(name)?name:'needs';
  if(nextRoute!=='request'||id!==selected){previewOpen=false;noteMode='';}
  route=nextRoute;if(route==='request'){selected=id;if(drafts.get(id)?.trim())noteMode=draftModes.get(id)||'note';}
  render(navigationDirection);navigationDirection=1;
  if(!opened)setOpen(true);
}
function applyTheme(){document.documentElement.dataset.theme=state.theme;$('#stay-canvas')?.contentWindow.postMessage({type:'gather-theme',theme:state.theme},'*');}
function reset(){state.answers={};state.later=[];state.notes={};state.paused=[];state.allowed=false;state.hotel='carpenter';drafts.clear();draftModes.clear();contextDrafts.clear();previewOpen=false;noteMode='';filter='waiting';save();rendered='';go('needs');notify('Fresh moments, ready.');}
window.addEventListener('message',e=>{
  const frame=$('#stay-canvas');if(!frame||e.source!==frame.contentWindow||e.data?.type!=='gather-stay'||!stays[e.data.hotel]||state.answers[selected])return;
  state.hotel=e.data.hotel;save();
  const stay=stays[state.hotel];
  $('#stay-summary').outerHTML=staySummary().split('<div class="stay-facts">')[0];
  if(!state.answers[selected])$('.approval-line').innerHTML=`<span>Approve ${stay.name}</span><strong>${stay.price}<small> total</small></strong>`;
});
window.addEventListener('hashchange',readRoute);
document.addEventListener('keydown',e=>{
  if($('#shortcuts').open)return;
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='j'){e.preventDefault();setOpen(!opened);return;}
  const editing=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
  if(editing){
    if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&$('#note-form')){e.preventDefault();$('#note-form').requestSubmit();}
    if(e.key==='Escape'){e.preventDefault();document.activeElement.blur();}return;
  }
  if(e.metaKey||e.ctrlKey||e.altKey)return;
  if(e.key==='Escape'){e.preventDefault();if(!opened)setOpen(true);else if(route==='request'){filter='waiting';go('needs');}else if(['context','connections','preferences'].includes(route))go('you');else setOpen(false);return;}
  if(!opened)return;
  if(route==='request'){
    if(e.key.toLowerCase()==='j'){e.preventDefault();step(-1);}
    if(e.key.toLowerCase()==='k'){e.preventDefault();step(1);}
    if(e.key.toLowerCase()==='n'&&!state.answers[selected]){e.preventDefault();if(current().type!=='question'){noteMode=draftModes.get(selected)||'note';draftModes.set(selected,noteMode);render();}focusReply();}
    if(/^[1-2]$/.test(e.key)&&current().type==='choice'&&!state.answers[selected]){e.preventDefault();answer(current().options[Number(e.key)-1]);}
  }
});
$('#help').onclick=()=>$('#shortcuts').showModal();
$('#close-help').onclick=()=>$('#shortcuts').close();
applyTheme();readRoute();pressFeedback();
