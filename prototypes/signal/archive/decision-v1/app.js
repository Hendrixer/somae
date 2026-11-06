import { demoDevices, defaultMessageDeviceId } from './message-model.js';
import { createMessageUI } from './message-ui.js';
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',back:'<path d="m14 6-6 6 6 6"/>',next:'<path d="m10 6 6 6-6 6"/>',check:'<path d="m5 12 4 4L19 6"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',expand:'<path d="M14 4h6v6M20 4l-8 8M10 20H4v-6M4 20l8-8"/>',plus:'<path d="M12 5v14M5 12h14"/>',clock:'<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',up:'<path d="M12 19V5m-5 5 5-5 5 5"/>',down:'<path d="m7 9 5 5 5-5"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>'};
const icon=id=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[id]||icons.arrow}</svg>`;
const senderMarks={
 Claude:{image:'./assets/claude.svg',style:'claude'},
 ChatGPT:{image:'./assets/chatgpt.svg',style:'chatgpt'},
 Codex:{image:'./assets/chatgpt.svg',style:'chatgpt'},
 Daylight:{style:'daylight',drawing:'<circle cx="16" cy="16" r="5" fill="currentColor"/><path d="M16 3v4m0 18v4M3 16h4m18 0h4M6.8 6.8l2.9 2.9m12.6 12.6 2.9 2.9m0-18.4-2.9 2.9M9.7 22.3l-2.9 2.9" fill="none" stroke="currentColor" stroke-width="2.2"/>'},
 Orbit:{style:'orbit-agent',drawing:'<circle cx="16" cy="16" r="6" fill="currentColor"/><ellipse cx="16" cy="16" rx="14" ry="5.5" transform="rotate(-35 16 16)" fill="none" stroke="currentColor" stroke-width="1.8"/>'}
};
function senderIcon(name){
 const mark=senderMarks[name];const initial=esc((name.trim()[0]||'?').toUpperCase());
 return `<span class="sender-icon ${mark?.style||'sender-initial'}" aria-hidden="true">${mark?.image?`<span class="sender-fallback">${initial}</span><img data-sender-image src="${mark.image}" alt="" draggable="false">`:mark?.drawing?`<svg viewBox="0 0 32 32" aria-hidden="true">${mark.drawing}</svg>`:initial}</span>`;
}
// Keep the sender recognizable if a custom image becomes unavailable.
document.addEventListener('error',event=>{if(event.target.matches?.('img[data-sender-image]'))event.target.parentElement.classList.add('image-failed');},true);
const signals=[
 {id:'launch',agent:'Claude',project:'Somae launch',type:'review',title:'Go loud?',copy:'Two directions for the launch. One refuses to blend in.',hint:'Choose a creative direction',scope:'Connected by you. May submit design reviews; cannot publish.',context:'Your brief: make Somae feel unmistakable. These are working concepts, not a live website.'},
 {id:'train',agent:'ChatGPT',project:'Japan trip',type:'approval',title:'Take the early train?',copy:'A window seat, a slower morning in Tokyo. This fare is refundable until the day before.',hint:'Approve a $148 train ticket',scope:'Connected by you. Booking requires your approval for this exact fare.',context:'Kyoto → Tokyo · November 12 · 09:24–11:36 · One adult · USD 148 total. This prototype makes no reservation.'},
 {id:'focus',agent:'Daylight',project:'Tomorrow',type:'question',title:'What gets your best hours?',copy:'Tomorrow is getting full. Tell me one thing to make room for.',hint:'Reply with a priority',scope:'Connected by you. May suggest calendar changes; cannot move events without approval.',context:'You asked for fewer fragmented days. I’ll propose a block around your existing commitments.'},
 {id:'connect',agent:'Orbit',project:'New connection',type:'permission',title:'Let Orbit in?',copy:'“I have a concept to show you. Can I send it over for a review?”',hint:'Allow one review request',scope:'A new agent found your handle. It has no permission to contact you yet.',context:'This grant allows exactly one review request. No access to your context, files, or other agents.'}
];
const storageKey='somae-signal-v1';
let loaded={};try{loaded=JSON.parse(localStorage.getItem(storageKey)||'{}');}catch{}
const state={material:'electric',answers:{},later:[],notes:{},direction:'volt',paused:[],context:'Keep the ask small. Give me the tradeoff.\n\nAsk before booking, publishing, or changing my calendar.\n\nSomae should feel like a thought I can act on.',...loaded};
if(!['electric','infrared','afterhours'].includes(state.material))state.material='electric';
if(!['volt','type'].includes(state.direction))state.direction='volt';
state.paused=state.paused.map(name=>({Muse:'Claude',Roam:'ChatGPT'}[name]||name));
const drafts=new Map();
let contextDraft=state.context,currentId='launch',mode='moment',awake=true,canvasOpen=false,thoughtMode='',search='',activeResult=0,toastTimer,animationToken=0;
const reduced=matchMedia('(prefers-reduced-motion:reduce)');
let previewDevice=demoDevices.find(device=>device.id===new URLSearchParams(location.search).get('device'))||demoDevices.find(device=>device.id===defaultMessageDeviceId);
const save=()=>{try{localStorage.setItem(storageKey,JSON.stringify(state));}catch{}};
const messageUI=createMessageUI({state,save:()=>save(),go,render,icon,senderIcon,esc,toast,getDevice:()=>previewDevice});
save();
const allSignals=()=>[...signals,...messageUI.signals()];
const current=()=>allSignals().find(s=>s.id===currentId)||signals[0];
const waiting=()=>allSignals().filter(s=>!state.answers[s.id]&&!state.later.includes(s.id));
const on=(selector,fn)=>{const el=$(selector);if(el)el.onclick=fn;};
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2400);}
function animate(el,frames,options={}){if(!el||reduced.matches)return null;return el.animate(frames,{duration:260,easing:'cubic-bezier(.16,1,.3,1)',...options});}
reduced.addEventListener('change',()=>{if(reduced.matches)document.getAnimations().forEach(a=>a.finish());});
function layout(mutate){
 const panel=$('#instrument');const before=panel.getBoundingClientRect();panel.getAnimations().forEach(a=>a.cancel());mutate();const after=panel.getBoundingClientRect();
 if(awake&&before.width&&before.height&&(Math.abs(before.width-after.width)>1||Math.abs(before.height-after.height)>1))animate(panel,[{width:`${before.width}px`,height:`${before.height}px`},{width:`${after.width}px`,height:`${after.height}px`}],{duration:330});
}
function setAwake(value){
 awake=value;const token=++animationToken;const panel=$('#instrument');panel.getAnimations().forEach(a=>a.cancel());panel.inert=!value;panel.setAttribute('aria-hidden',String(!value));$('#beacon').hidden=value;$('#away-hint').hidden=value;updateChrome();
 if(value){panel.hidden=false;animate(panel,[{opacity:0,transform:'translateY(12px) scale(.975)',clipPath:'inset(44% 3% round 12px)'},{opacity:1,transform:'none',clipPath:'inset(0% 0% round 12px)'}],{duration:350});focusView();}
 else{const a=animate(panel,[{opacity:1,transform:'none',clipPath:'inset(0% 0% round 12px)'},{opacity:0,transform:'translateY(-8px) scale(.98)',clipPath:'inset(44% 3% round 12px)'}],{duration:170});if(a)a.finished.then(()=>{if(token===animationToken&&!awake)panel.hidden=true;}).catch(()=>{});else panel.hidden=true;$('#beacon').focus({preventScroll:true});}
}
function homeRoute(){const list=waiting();return list.length?`moment/${list.some(s=>s.id===currentId)?currentId:list[0].id}`:'clear';}
function summon(){
 const route=homeRoute();const [name,id]=route.split('/');mode=name;if(id)currentId=id;
 search='';canvasOpen=false;thoughtMode=mode==='moment'&&current().type!=='question'?drafts.get(currentId)?.mode||'':'';
 render();setAwake(true);history.replaceState(null,'',`#${route}`);
}
function go(path){if(location.hash===`#${path}`)readRoute();else location.hash=path;}
function focusView(){if(mode==='find')$('#search')?.focus({preventScroll:true});else if(mode==='new')messageUI.focus();else $('#view h1')?.focus({preventScroll:true});}
function updateChrome(){const n=waiting().length;$('#signal-count').textContent=n?`${n} signal${n===1?'':'s'}`:'All clear';$('#beacon-count').textContent=n||'✓';$('#new-message-label').textContent=state.messageDraft.text.trim()?'Draft':'New';$('#new-message').title=state.messageDraft.text.trim()?'Resume message draft · Command N':'New message · Command N';$('#sample-signal').hidden=mode!=='sent'||!messageUI.hasReceipt();}
function action(label,id,primary=false,key=''){return `<button class="action ${primary?'primary':''}" id="${id}"><span class="action-label">${label}</span>${key?`<kbd>${key}</kbd>`:icon('arrow')}</button>`;}
function directionName(){return state.direction==='volt'?'Volt':'Type';}
function replyForm(){const suggestions=current().suggestions||[{label:'Deep work',text:'Two hours of focus'},{label:'A real lunch',text:'A proper, unhurried lunch'},{label:'A slow start',text:'Nothing before ten'}];const draft=drafts.get(currentId)?.text||'';return `<form class="reply-box" id="reply-form"><label for="reply" class="action-caption">YOUR ANSWER</label><textarea id="reply" rows="3" placeholder="${current().originalMessage?'Your answer…':'Make room for…'}">${esc(draft)}</textarea><div class="reply-bottom"><span>⌘ ↵ to send</span><button class="reply-send" id="reply-send" aria-label="Send reply" ${draft.trim()?'':'disabled'}>${icon('up')}</button></div></form><div class="suggestions">${suggestions.map(item=>`<button data-suggest="${esc(item.text)}">${esc(item.label)}</button>`).join('')}</div>`;}
function controls(s){
 if(s.type==='review')return `<div class="action-caption">SELECTED / <span class="selected-direction">${directionName()}</span></div>${action(`Use ${directionName()}`,'respond',true,'1')}${action('Give feedback','feedback',false,'2')}<p class="action-detail">A direction. No publishing yet.</p>`;
 if(s.type==='approval')return `<div class="action-caption">ONE ADULT / ONE WAY</div>${action('Approve $148','respond',true,'1')}${action('Find another train','alternative',false,'2')}<p class="action-detail">USD total · seat & taxes included</p>`;
 if(s.type==='question')return replyForm();
 return `<label class="scope"><input type="checkbox" id="grant" checked><span><strong>One review request</strong>No context or file access.</span></label>${action('Allow once','respond',true,'1')}${action('Decline','decline',false,'2')}`;
}
function thought(){if(!thoughtMode)return '';const draft=drafts.get(currentId)?.text||'';return `<form class="thought" id="thought-form"><div><label for="thought">${thoughtMode==='revision'?'FEEDBACK FOR '+current().agent.toUpperCase():'ADD A THOUGHT'}</label><textarea id="thought" rows="2" placeholder="${thoughtMode==='revision'?'What should change?':'One useful detail…'}">${esc(draft)}</textarea><div class="thought-hint">${thoughtMode==='revision'?'This asks for another pass.':'This adds context without answering the signal.'}</div></div><button class="send-thought" id="send-thought" ${draft.trim()?'':'disabled'}>${thoughtMode==='revision'?'Request a revision':'Add thought'} ${icon('up')}</button></form>`;}
function moment(){
 const s=current();if(state.answers[s.id])return receipt(s);
 return `<div class="decision ${s.type}"><div><div class="origin"><button id="source" aria-expanded="false" aria-label="About ${s.agent}">${senderIcon(s.agent)} ${s.agent} ${icon('down')}</button><span class="slash">/</span><span class="project">${esc(s.project.toUpperCase())}</span></div><h1 tabindex="-1">${esc(s.title)}</h1><p class="request-copy">${esc(s.copy)}</p>${s.type==='approval'?'<div class="trip-facts"><span><strong>09:24 → 11:36</strong>KYOTO → TOKYO</span><span><strong>12 NOV</strong>1 WINDOW SEAT</span></div>':''}${s.originalMessage?`<details class="message-origin"><summary>Your message</summary><p>${esc(s.originalMessage)}</p></details>`:''}${s.type==='review'?`<button class="preview-link" id="preview" aria-expanded="${canvasOpen}">${icon('expand')} ${canvasOpen?'Close directions':'Open the directions'} <kbd>P</kbd></button>`:''}<div class="provenance" id="provenance" hidden><strong>${esc(s.scope)}</strong><p>${esc(s.context)}</p></div>${state.notes[s.id]?.length?`<p class="note-count">${state.notes[s.id].length} thought${state.notes[s.id].length===1?'':'s'} added${state.notes[s.id].length?` · ${esc(state.notes[s.id].at(-1))}`:''}</p>`:''}</div><div class="decision-actions">${controls(s)}</div></div>${s.type!=='question'?thought():''}`;
}
function receipt(s){return `<div class="receipt"><div><span class="receipt-label">${senderIcon(s.agent)} <span>${icon('check')} RESPONSE SENT</span></span><h1 tabindex="-1">Back to ${s.agent}.</h1><p>${esc(state.answers[s.id].text)}</p></div><div class="receipt-actions">${action(waiting().length?'Next signal':'Get back to it','next-signal',true)}<button class="text-action" id="undo">Undo response</button></div></div>`;}
const commands=[
 {id:'new',title:'New message',sub:'Send an idea or a question to an agent',tag:'⌘ N'},
 {id:'context',title:'Your context',sub:'The brief your agents work from',tag:'SPACE'},
 {id:'connections',title:'Connections',sub:'Control who can reach you',tag:'ACCESS'},
 {id:'materials',title:'Change the material',sub:'Electric · Infrared · After hours',tag:'LOOK'},
 {id:'later',title:'Set aside',sub:'Signals you saved for later',tag:'LATER'},
 {id:'history',title:'Past responses',sub:'Review or undo a response',tag:'HISTORY'},
 {id:'replay',title:'Replay the experiment',sub:'Restore the four sample signals',tag:'RESET'},
 {id:'quiet',title:'Disappear for now',sub:'Everything is one shortcut away',tag:'ESC'}
];
function results(){const q=search.toLowerCase().trim();return [...waiting().map(s=>({id:`moment/${s.id}`,title:s.title,sub:`${s.agent} / ${s.project}`,tag:s.type,sender:s.agent})),...commands].filter(x=>`${x.title} ${x.sub} ${x.tag}`.toLowerCase().includes(q));}
function resultRows(list){return list.map((r,i)=>`<button class="result ${i===activeResult?'selected':''}" data-result="${i}" data-target="${r.id}">${r.sender?senderIcon(r.sender):`<span class="result-index">${String(i+1).padStart(2,'0')}</span>`}<span><strong>${r.title}</strong><small>${r.sub}</small></span><span class="result-tag">${r.tag}</span>${i===activeResult?'<kbd>↵</kbd>':''}</button>`).join('');}
function finder(){return `<div class="search-head">${icon('search')}<input id="search" aria-label="Find a signal or command" placeholder="Find your next move…" value="${esc(search)}" autocomplete="off" spellcheck="false"></div><div class="result-list" id="results"><div class="result-group">${search?'MATCHES':'SIGNALS & COMMANDS'}</div>${resultRows(results())||'<div class="empty">No match. Try an agent, a signal, or “context”.</div>'}</div>`;}
function utilityHead(kicker,title,copy){return `<span class="eyebrow">${kicker}</span><h1 class="utility-title" tabindex="-1">${title}</h1><p class="utility-copy">${copy}</p>`;}
function utility(){
 if(['new','sent'].includes(mode))return messageUI.view(mode);
 if(mode==='clear')return `<div class="receipt clear-state"><div><span class="eyebrow">ROOM TO THINK</span><h1 tabindex="-1">Nothing needs you.</h1><p>${state.later.length?'A few things are set aside for later.':'Your agents can carry on.'}</p></div><div class="receipt-actions">${action('New message','clear-start',true)}<button class="text-action" id="clear-hide">Back to my day</button></div></div>`;
 if(mode==='context')return `<section class="utility-page">${utilityHead('YOUR WORDS','Set the tone.','A small brief. Saved by you, shared on your terms.')}<label for="context" hidden>Your context</label><textarea id="context" class="context-editor">${esc(contextDraft)}</textarea><div class="utility-save"><span>Agents can suggest.<br>You decide what stays.</span>${action('Save context','save-context',true)}</div></section>`;
 if(mode==='materials')return `<section class="utility-page">${utilityHead('MAKE IT YOURS','Choose your frequency.','Same instrument. A different charge.')}<div class="material-options">${[['electric','Electric','INK / ACID'],['infrared','Infrared','OXIDE / HEAT'],['afterhours','After hours','PLUM / ULTRAVIOLET']].map(([id,label,sub])=>`<button class="material" data-material="${id}" aria-pressed="${state.material===id}"><span class="material-preview"></span><strong>${label}</strong><small>${sub}</small></button>`).join('')}</div></section>`;
 if(mode==='connections')return `<section class="utility-page">${utilityHead('YOUR PERMISSION','Who gets through.','A handle opens a door. A grant decides what comes through.')}<div>${[
 ['Claude','Submit design reviews'],['ChatGPT','Request booking approvals'],['Daylight','Suggest calendar changes'],['Codex','Request decisions; send signals'],...(state.answers.connect?.grant?[['Orbit','One review request · no context or files']]:[])
 ].map(([name,scope])=>`<div class="agent-row">${senderIcon(name)}<div><strong>${name}</strong><small>${state.paused.includes(name)?'Access paused · existing work may continue':scope}</small></div><button data-agent="${name}">${state.paused.includes(name)?'Resume':'Pause'}</button></div>`).join('')}</div></section>`;
 const list=allSignals().filter(s=>mode==='later'?state.later.includes(s.id)&&!state.answers[s.id]:state.answers[s.id]);
 return `<section class="utility-page">${utilityHead(mode==='later'?'ON YOUR TIME':'THE PAPER TRAIL',mode==='later'?'Set aside.':'Said. Done.',mode==='later'?'No countdown. Come back when it makes sense.':'Your responses, with room to reconsider.')}<div>${list.length?list.map(s=>`<button class="result" data-route="moment/${s.id}">${senderIcon(s.agent)}<span><strong>${s.title}</strong><small>${mode==='later'?s.hint:esc(state.answers[s.id].text)}</small></span>${icon('arrow')}</button>`).join(''):'<p class="empty">Nothing here yet.</p>'}</div></section>`;
}
function footer(){
 if(mode==='find')return `<span class="foot-left"><span>↑ ↓ to move</span><span>↵ to open</span></span><span class="foot-right"><button id="back">Back <kbd>esc</kbd></button></span>`;
 if(mode==='new')return `<span class="foot-left"><button id="back">${icon('back')} ${messageUI.isPicking()?'Back to your draft':'Back to signals'}</button></span><span class="foot-right"><span id="message-draft-status">${state.messageDraft.text.trim()?'Draft saved':'⌘ ↵ to send'}</span></span>`;
 if(mode==='sent')return `<span class="foot-left"><button id="back">${icon('back')} Back to signals</button></span><span class="foot-right"><button id="hide">Hide <kbd>esc</kbd></button></span>`;
 if(mode==='clear')return `<span class="foot-left"><button data-route="find">Signals & commands ${icon('arrow')}</button></span><span class="foot-right"><button data-route="later">Set aside</button></span>`;
 if(mode!=='moment')return `<span class="foot-left"><button id="back">${icon('back')} Signals & commands</button></span><span class="foot-right"><span>Local prototype</span></span>`;
 const answered=Boolean(state.answers[currentId]),queue=waiting(),index=queue.findIndex(s=>s.id===currentId);
 return `<span class="foot-left">${!answered?`<span class="stepper"><button id="previous" aria-label="Previous signal">${icon('back')}</button><span>${index<0?'LATER':`${String(index+1).padStart(2,'0')} / ${String(queue.length).padStart(2,'0')}`}</span><button id="next" aria-label="Next signal">${icon('next')}</button></span>`:'<span>Response sent</span>'}${!answered&&current().type!=='question'?`<span class="foot-divider"></span><button id="note">${icon(thoughtMode?'close':'plus')} ${thoughtMode?'Close thought':drafts.get(currentId)?.text?'Draft thought':'Add a thought'}</button>`:''}</span><span class="foot-right">${!answered?`<button id="later">Set aside ${icon('clock')}</button>`:''}<button id="hide">Hide <kbd>esc</kbd></button></span>`;
}
function render({focus=true}={}){
 layout(()=>{const panel=$('#instrument');panel.classList.toggle('utility',mode!=='moment');panel.classList.toggle('wide',mode==='moment'&&canvasOpen&&!state.answers[currentId]);$('#view').innerHTML=mode==='moment'?moment():mode==='find'?finder():utility();$('#instrument-foot').innerHTML=footer();renderCanvas();bind();updateChrome();});
 animate($('#view'),[{opacity:.2,transform:'translateY(6px)'},{opacity:1,transform:'none'}],{duration:210});if(focus&&awake)focusView();
}
function renderCanvas(){
 const wrap=$('#canvas-wrap');const show=mode==='moment'&&currentId==='launch'&&canvasOpen&&!state.answers.launch;wrap.hidden=!show;
 if(!show){wrap.innerHTML='';return;}
 if(!$('#launch-canvas'))wrap.innerHTML=`<div class="canvas-title"><span class="canvas-sender">${senderIcon(current().agent)} ${current().agent.toUpperCase()} / INTERACTIVE DIRECTIONS</span><button id="close-canvas">Close canvas ×</button></div><iframe id="launch-canvas" title="Interactive Somae launch directions" sandbox="allow-scripts" src="./canvases/launch.html?direction=${state.direction}&locked=0"></iframe>`;
 const frame=$('#launch-canvas');const sync=()=>frame.contentWindow.postMessage({type:'signal-canvas-lock',locked:Boolean(state.answers.launch)},'*');frame.onload=sync;sync();on('#close-canvas',()=>toggleCanvas());
}
function bind(){
 messageUI.bind(mode);
 $$('[data-route]').forEach(b=>b.onclick=()=>go(b.dataset.route));
 on('#respond',()=>{if(current().type==='permission'&&!$('#grant').checked)return;answer(current().type==='review'?`Use ${directionName()} for the launch direction.`:current().type==='approval'?'Approved Kyoto → Tokyo · Nov 12 · 09:24 · $148 USD.':'Allowed Orbit to send one review request.');});
 on('#alternative',()=>answer('Find another train. No booking approved.'));
 on('#decline',()=>answer('Declined the connection request.'));
 on('#feedback',()=>openThought('revision'));
 on('#note',()=>{if(thoughtMode){thoughtMode='';render({focus:false});$('#note')?.focus();}else openThought(drafts.get(currentId)?.mode||'note');});
 on('#source',()=>{const p=$('#provenance');p.hidden=!p.hidden;$('#source').setAttribute('aria-expanded',String(!p.hidden));});
 on('#preview',toggleCanvas);
 on('#previous',()=>step(-1));on('#next',()=>step(1));
 on('#next-signal',()=>waiting().length?step(1):setAwake(false));
 on('#undo',()=>{delete state.answers[currentId];save();render();$('#respond, #reply')?.focus({preventScroll:true});});
 on('#later',()=>{if(!state.later.includes(currentId))state.later.push(currentId);save();toast('Set aside. No rush.');if(waiting().length)step(1);else setAwake(false);});
 on('#hide',()=>setAwake(false));on('#message-away',()=>setAwake(false));on('#clear-hide',()=>setAwake(false));on('#clear-start',()=>go('new'));on('#back',()=>{if(awake&&mode==='new'&&messageUI.leavePicker())return;go(['new','find','sent'].includes(mode)?homeRoute():'find');});
 if($('#grant'))$('#grant').onchange=()=>$('#respond').disabled=!$('#grant').checked;
 if($('#search'))$('#search').oninput=e=>{search=e.target.value;activeResult=0;renderResults();};bindResults();
 if($('#context'))$('#context').oninput=e=>contextDraft=e.target.value;
 on('#save-context',()=>{state.context=contextDraft;save();toast('Context saved.');});
 $$('.material[data-material]').forEach(b=>b.onclick=()=>{state.material=b.dataset.material;document.documentElement.dataset.material=state.material;save();render({focus:false});$(`.material[data-material="${state.material}"]`).focus({preventScroll:true});});
 $$('[data-agent]').forEach(b=>b.onclick=()=>{const name=b.dataset.agent;state.paused=state.paused.includes(name)?state.paused.filter(n=>n!==name):[...state.paused,name];save();render({focus:false});$(`[data-agent="${name}"]`).focus({preventScroll:true});});
 $$('[data-suggest]').forEach(b=>b.onclick=()=>{const input=$('#reply');input.value=b.dataset.suggest;input.dispatchEvent(new Event('input'));input.focus();});
 bindDraft('#reply','#reply-send','reply');bindDraft('#thought','#send-thought',thoughtMode);
 if($('#reply-form'))$('#reply-form').onsubmit=e=>{e.preventDefault();const text=$('#reply').value.trim();if(text)answer(text,false);};
 if($('#thought-form'))$('#thought-form').onsubmit=e=>{e.preventDefault();const text=$('#thought').value.trim();if(!text)return;if(thoughtMode==='revision')answer('Revision requested: '+text,false);else{state.notes[currentId]=[...(state.notes[currentId]||[]),text];drafts.delete(currentId);thoughtMode='';save();render();toast('Thought added. The decision is still yours.');}};
}
function bindDraft(selector,send,kind){const input=$(selector);if(!input)return;input.oninput=()=>{drafts.set(currentId,{text:input.value,mode:kind});$(send).disabled=!input.value.trim();};}
function openThought(kind){thoughtMode=kind;const draft=drafts.get(currentId);if(draft)drafts.set(currentId,{...draft,mode:kind});render({focus:false});$('#thought')?.focus({preventScroll:true});$('#thought-form')?.scrollIntoView({block:'nearest'});}
function renderResults(){const list=results();activeResult=Math.max(0,Math.min(activeResult,list.length-1));$('#results').innerHTML=`<div class="result-group">${search?'MATCHES':'SIGNALS & COMMANDS'}</div>${resultRows(list)||'<div class="empty">No match. Try an agent, a signal, or “context”.</div>'}`;bindResults();}
function selectResult(index){activeResult=index;$$('[data-result]').forEach(b=>{const selected=Number(b.dataset.result)===index;b.classList.toggle('selected',selected);b.querySelector('kbd')?.remove();if(selected){const marker=document.createElement('kbd');marker.textContent='↵';b.append(marker);}});}
function bindResults(){$$('[data-result]').forEach(b=>{b.onclick=()=>activate(b.dataset.target);b.onpointerenter=()=>selectResult(Number(b.dataset.result));b.onfocus=()=>selectResult(Number(b.dataset.result));});}
function activate(target){if(target==='quiet'){setAwake(false);return;}if(target==='replay'){reset();return;}go(target);}
function answer(text,includeDraft=true){
 const draft=drafts.get(currentId)?.text.trim();if(includeDraft&&draft)state.notes[currentId]=[...(state.notes[currentId]||[]),draft];
 state.answers[currentId]={text,...(currentId==='launch'?{direction:state.direction}:{}),...(currentId==='connect'?{grant:text.startsWith('Allowed Orbit')}:{})};state.later=state.later.filter(id=>id!==currentId);drafts.delete(currentId);thoughtMode='';canvasOpen=false;save();render();$('#undo')?.focus({preventScroll:true});
 animate($('.receipt-label'),[{opacity:0,transform:'translateX(-12px)'},{opacity:1,transform:'none'}],{duration:300});
}
function toggleCanvas(){if(currentId!=='launch'||state.answers.launch)return;canvasOpen=!canvasOpen;render({focus:false});(canvasOpen?$('#close-canvas'):$('#preview'))?.focus({preventScroll:true});}
function step(direction){const list=waiting();if(!list.length){go('clear');return;}const all=allSignals();const index=all.findIndex(s=>s.id===currentId);for(let n=1;n<=all.length;n++){const candidate=all[(index+direction*n+all.length*2)%all.length];if(list.some(s=>s.id===candidate.id)){go(`moment/${candidate.id}`);return;}}}
function reset(){messageUI.reset();state.answers={};state.later=[];state.notes={};state.paused=[];state.direction='volt';drafts.clear();canvasOpen=false;thoughtMode='';save();go('moment/launch');toast('Four fresh signals.');}
function readRoute(){
 const [name,id]=location.hash.slice(1).split('/');
 if(['activity','task'].includes(name)||(name==='sent'&&!messageUI.hasReceipt())){history.replaceState(null,'',`#${homeRoute()}`);readRoute();return;}
 const nextMode=['find','context','connections','materials','later','history','new','sent','clear'].includes(name)?name:'moment';const nextId=allSignals().some(s=>s.id===id)?id:allSignals().some(s=>s.id===currentId)?currentId:waiting()[0]?.id||signals[0].id;
 if(nextMode!=='moment'||nextId!==currentId){canvasOpen=false;thoughtMode='';}
 mode=nextMode;if(mode==='moment'){currentId=nextId;thoughtMode=current().type==='question'?'':drafts.get(currentId)?.mode||'';}else if(mode==='find'){search='';activeResult=0;}
 render();if(!awake)setAwake(true);
}
window.addEventListener('message',e=>{
 const frame=$('#launch-canvas');if(!frame||e.source!==frame.contentWindow)return;
 if(e.data?.type==='signal-shortcut'){
  if(e.data.action==='find')go('find');
  else if(e.data.action==='new-message')go('new');
  else if(e.data.action==='close')toggleCanvas();
  return;
 }
 if(e.data?.type!=='signal-direction'||!['volt','type'].includes(e.data.direction)||state.answers.launch)return;
 state.direction=e.data.direction;save();$('.selected-direction').textContent=directionName();$('#respond .action-label').textContent=`Use ${directionName()}`;
});
window.addEventListener('hashchange',readRoute);
document.addEventListener('keydown',e=>{
 if(document.querySelector('dialog[open]')){
  if((e.metaKey||e.ctrlKey)&&['k','n'].includes(e.key.toLowerCase()))e.preventDefault();
  return;
 }if(e.repeat)return;
 if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='n'){e.preventDefault();go('new');return;}
 if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(!awake)summon();else if(mode==='find')go(homeRoute());else go('find');return;}
 const editing=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
 if(mode==='find'&&awake){
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const list=results();activeResult=(activeResult+(e.key==='ArrowDown'?1:-1)+list.length)%Math.max(1,list.length);renderResults();$(`[data-result="${activeResult}"]`)?.scrollIntoView({block:'nearest'});return;}
  if(e.key==='Enter'&&document.activeElement===$('#search')){e.preventDefault();const r=results()[activeResult];if(r)activate(r.id);return;}
 }
 if(editing&&(e.metaKey||e.ctrlKey)&&e.key==='Enter'){const form=document.activeElement.closest('form');if(form){e.preventDefault();form.requestSubmit();}return;}
 if(e.key==='Escape'){e.preventDefault();if(awake&&mode==='new'&&messageUI.leavePicker())return;if(editing&&mode!=='find'){document.activeElement.blur();return;}if(!awake){summon();return;}if(mode==='clear'){setAwake(false);return;}if(mode!=='moment'){go(['find','new','sent'].includes(mode)?homeRoute():'find');return;}if(canvasOpen){toggleCanvas();return;}if(thoughtMode){thoughtMode='';render();return;}setAwake(false);return;}
 if(editing||e.metaKey||e.ctrlKey||e.altKey)return;
 if(!awake){if(e.key===' '){e.preventDefault();summon();}return;}
 if(mode!=='moment')return;
 if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();step(e.key==='ArrowLeft'?-1:1);return;}
 if(state.answers[currentId])return;
 if(e.key.toLowerCase()==='p'){e.preventDefault();toggleCanvas();}
 if(e.key.toLowerCase()==='n'&&current().type!=='question'){e.preventDefault();openThought(drafts.get(currentId)?.mode||'note');}
 if(e.key==='1'){e.preventDefault();$('#respond:not(:disabled)')?.click();}
 if(e.key==='2'){e.preventDefault();$('#feedback, #alternative, #decline')?.click();}
});
on('#home',()=>go(homeRoute()));on('#find',()=>go('find'));on('#new-message',()=>go('new'));
$('#preview-device').onchange=e=>{previewDevice=demoDevices.find(device=>device.id===e.target.value)||demoDevices[0];const url=new URL(location.href);url.searchParams.set('device',previewDevice.id);history.replaceState(null,'',url);render({focus:false});toast(`Previewing Somae on ${previewDevice.name}.`);};
on('#sample-signal',()=>messageUI.simulateSignal());on('#dismiss',()=>setAwake(false));on('#beacon',summon);on('#summon',summon);on('#help',()=>$('#keys').showModal());on('#close-keys',()=>$('#keys').close());
document.documentElement.dataset.material=state.material;$('#preview-device').value=previewDevice.id;readRoute();
