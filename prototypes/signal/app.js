import { demoDevices } from './message-model.js';
import { agents, agentById, createState, restoreState, attention, latestSignal, conversationFor, endpointAvailability, replyAvailability, saveDraft, reviewDraft, submitResponse, startMessage, simulateReply, simulateSignalState, setOnline, addApproval, signalQueue, clearResult } from './conversation-model.js';
const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
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
const storageKey='somae-signal-v2';
let loaded,legacy={};try{loaded=JSON.parse(localStorage.getItem(storageKey)||'null');legacy=JSON.parse(localStorage.getItem('somae-signal-v1')||'{}');}catch{}
let state=restoreState(loaded,legacy);
const save=()=>{try{localStorage.setItem(storageKey,JSON.stringify(state));}catch{}};
let device=demoDevices.find(item=>item.id===new URLSearchParams(location.search).get('device'))||demoDevices[0];
let mode='moment',currentId='launch',awake=true,canvasOpen=false,historyOpen=false,replyMode='',picking=false,search='',activeResult=0,toastTimer,animationToken=0,contextDraft=state.context;
const reduced=matchMedia('(prefers-reduced-motion:reduce)');
const current=()=>state.signals[currentId];
const conversation=()=>conversationFor(state,current())||state.conversations[currentId];
const agentFor=conv=>agentById(conv.endpointId);
const locationName=agent=>agent.host==='local'?agent.locationLabel:'Hosted';
const on=(selector,handler)=>{const node=$(selector);if(node)node.onclick=handler;};
const action=(label,id,primary=false,key='')=>`<button class="action ${primary?'primary':''}" id="${id}"${key?` data-option-key="${key}" aria-keyshortcuts="${key}"`:''}><span class="action-label">${label}</span>${key?`<kbd>${key}</kbd>`:icon('arrow')}</button>`;
const utilityHead=(label,title,copy='')=>`<span class="eyebrow">${label}</span><h1 class="utility-title" tabindex="-1">${title}</h1>${copy?`<p class="utility-copy">${copy}</p>`:''}`;
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2400);}
function animate(element,frames,options={}){if(!element||reduced.matches)return null;return element.animate(frames,{duration:260,easing:'cubic-bezier(.16,1,.3,1)',...options});}
reduced.addEventListener('change',()=>{if(reduced.matches)document.getAnimations().forEach(animation=>animation.finish());});
function layout(mutate){const panel=$('#instrument'),before=panel.getBoundingClientRect();panel.getAnimations().forEach(animation=>animation.cancel());mutate();const after=panel.getBoundingClientRect();if(awake&&before.height&&Math.abs(before.height-after.height)>1)animate(panel,[{height:`${before.height}px`},{height:`${after.height}px`}],{duration:330});}
function go(route){if(location.hash===`#${route}`)readRoute();else location.hash=route;}
function setAwake(value){
 awake=value;const panel=$('#instrument'),token=++animationToken;panel.getAnimations().forEach(animation=>animation.cancel());panel.inert=!value;panel.setAttribute('aria-hidden',String(!value));$('#beacon').hidden=value;$('#away-hint').hidden=value;
 if(value){panel.hidden=false;animate(panel,[{opacity:0,transform:'translateY(12px) scale(.975)',clipPath:'inset(44% 3% round 12px)'},{opacity:1,transform:'none',clipPath:'inset(0% 0% round 12px)'}],{duration:350});focusView();}
 else{const animation=animate(panel,[{opacity:1,transform:'none'},{opacity:0,transform:'translateY(-8px) scale(.98)'}],{duration:170});if(animation)animation.finished.then(()=>{if(token===animationToken&&!awake)panel.hidden=true;}).catch(()=>{});else panel.hidden=true;$('#beacon').focus({preventScroll:true});}
 updateChrome();
}
function queueHome(){return signalQueue(state)[0]?`moment/${signalQueue(state)[0].id}`:'clear';}
function summon(){go(queueHome());if(!awake)setAwake(true);}
function advanceFrom(id,before=signalQueue(state)){
 const queue=signalQueue(state),index=before.findIndex(signal=>signal.id===id);
 const next=[...before.slice(index+1),...before.slice(0,Math.max(0,index))].find(signal=>queue.some(item=>item.id===signal.id))||queue.find(signal=>signal.id!==id)||queue[0];
 go(next?`moment/${next.id}`:'clear');
}
function step(direction){const queue=signalQueue(state);if(!queue.length){go('clear');return;}const index=queue.findIndex(signal=>signal.id===currentId);const next=queue[(index+(index<0&&direction<0?0:direction)+queue.length)%queue.length];go(`moment/${next.id}`);}
function moveOption(direction){
 if(!awake||mode!=='moment'||replyMode)return;
 const options=$$('.decision-actions [data-option-key]:not(:disabled)'),index=options.indexOf(document.activeElement);
 if(!options.length)return;
 const next=index<0?(direction>0?0:options.length-1):(index+direction+options.length)%options.length;
 options[next].focus({preventScroll:true});options[next].scrollIntoView({block:'nearest'});
}
function chooseOption(key){if(awake&&mode==='moment'&&!replyMode)$(`.decision-actions [data-option-key="${key}"]:not(:disabled)`)?.click();}
function setAside(){
 const signal=current();if(!awake||mode!=='moment'||!signal||signal.state!=='active'||signal.cleared)return;
 const before=signalQueue(state);signal.later=!signal.later;save();toast(signal.later?'Set aside. On your time.':'Back in your queue.');advanceFrom(currentId,before);
}
function focusView(){if(mode==='inbox')$('#search')?.focus({preventScroll:true});else if(mode==='new')picking?$('#view h1')?.focus():$('#message-text')?.focus({preventScroll:true});else if(replyMode)$('#reply')?.focus({preventScroll:true});else (mode==='moment'?$('.decision-actions [data-option-key]:not(:disabled)')||$('#view h1'):mode==='clear'?$('.clear-state #hide')||$('#view h1'):$('#view h1'))?.focus({preventScroll:true});}
function updateChrome(){
 const counts=attention(state),queue=signalQueue(state);$('#signal-count').textContent=queue.length?`${queue.length} signal${queue.length===1?'':'s'}`:'Caught up';
 $('#signal-count').title=`${counts.needs.length} need a response. Others can be read and cleared.`;
 $('#beacon-count').textContent=queue.length||'✓';$('#beacon').setAttribute('aria-label',`Summon Somae. ${queue.length} signals.`);
 $('#new-message-label').textContent=state.newDraft.text.trim()?'Draft':'New';
 const outbound=state.lastOutbound,conv=state.conversations[outbound?.conversationId];
 $('#sample-signal').hidden=!conv||!conv.messages.some(message=>message.id===outbound.messageId&&!message.replied&&message.delivery!=='failed');
 $('#preview-device').value=device.id;
 document.documentElement.dataset.previewDevice=device.id;
}
function badge(signal){if(signal.state==='withdrawn')return 'WITHDRAWN';if(signal.state==='expired')return 'EXPIRED';if(signal.state==='answered')return 'REPLIED';return signal.requiresResponse?signal.kind==='approval'?'APPROVAL':'NEEDS REPLY':'RESULT';}
function inboxRows(){
 const counts=attention(state);counts.fresh=signalQueue(state).filter(signal=>!signal.requiresResponse);const used=new Set([...counts.needs,...counts.fresh].map(signal=>signal.conversationId));
 const group=(label,records)=>records.map(record=>({...record,group:label}));
 const signalRow=signal=>({target:`moment/${signal.id}`,title:signal.title,sub:state.conversations[signal.conversationId].title,endpointId:state.conversations[signal.conversationId].endpointId,tag:badge(signal)});
 const recent=counts.recent.filter(conv=>!used.has(conv.id)).slice(0,5).map(conv=>{const signal=latestSignal(state,conv);return {target:`moment/${signal?.id||conv.id}`,title:conv.title,sub:conv.messages.at(-1)?.text||'Conversation',endpointId:conv.endpointId,tag:signal?.later?'SET ASIDE':'RECENT'};});
 const commands=[{target:'new',title:'New message',sub:'An idea, a question, something to make',tag:'⌘ N'},{target:'connections',title:'Your agents & handle',sub:'Connections and your Somae address',tag:'CONNECT'},{target:'context',title:'Your context',sub:'What you choose to share',tag:'CONTEXT'},{target:'materials',title:'Change the material',sub:'Electric, Infrared, After hours',tag:'LOOK'},{target:'later',title:'Set aside',sub:'Come back on your time',tag:'LATER'},{target:'replay',title:'Replay the demo',sub:'Restore the four conversations',tag:'RESET'}];
 const all=[...group('NEEDS YOU',counts.needs.map(signalRow)),...group('RESULTS',counts.fresh.map(signalRow)),...group('RECENT CONVERSATIONS',recent),...group('YOUR SPACE',commands)];
 const query=search.trim().toLowerCase();return all.filter(row=>!query||`${row.title} ${row.sub} ${row.tag} ${agentById(row.endpointId)?.name||''}`.toLowerCase().includes(query));
}
function rowHTML(row,index){const agent=agentById(row.endpointId);return `<button class="result ${index===activeResult?'selected':''}" data-result="${index}" data-target="${row.target}">${agent?senderIcon(agent.name):`<span class="result-index">${icon(row.target==='new'?'plus':'arrow')}</span>`}<span class="row-copy"><strong>${esc(row.title)}</strong><small>${agent?`${esc(agent.name)} · ${esc(locationName(agent))} / `:''}${esc(row.sub)}</small></span><span class="result-tag ${row.tag==='RESULT'?'neutral':''}">${row.tag}</span>${index===activeResult?'<kbd>↵</kbd>':''}</button>`;}
function inboxBody(){const rows=inboxRows();let previous='';return rows.map((row,index)=>{const heading=row.group!==previous?`<div class="result-group">${search?'MATCHES':row.group}</div>`:'';previous=search?'MATCHES':row.group;return heading+rowHTML(row,index);}).join('')||'<div class="empty">No match. Try an agent, a conversation, or “context”.</div>';}
function inbox(){return `<div class="inbox-title"><span>YOUR INBOX</span><span>${attention(state).needs.length?'A little attention, in one place.':'Room to think.'}</span></div><div class="search-head">${icon('search')}<input id="search" aria-label="Find a conversation or command" placeholder="Find your next move…" value="${esc(search)}" autocomplete="off" spellcheck="false"></div><div class="result-list inbox-list" id="results">${inboxBody()}</div>`;}
function sourceHTML(conv,signal){const agent=agentFor(conv);return `<div class="origin"><button id="source" aria-expanded="false" aria-label="About ${agent.name}, ${locationName(agent)}">${senderIcon(agent.name)} ${agent.name} ${icon('down')}</button><span class="slash">/</span><span class="project">${esc(conv.title)}</span>${agent.host==='local'?`<span class="location-pill">${esc(agent.locationLabel)}</span>`:''}</div><div class="provenance" id="provenance" hidden><strong>${esc(agent.role)} · ${esc(locationName(agent))}</strong><p>${esc(signal?.scope||'Connected by you. Context is included only when you choose.')}</p></div>`;}
function deliveryIssue(){
 return Object.values(state.conversations).flatMap(conv=>conv.messages.filter(message=>message.delivery==='failed'&&!message.issueHandled).map(message=>({conv,message}))).sort((a,b)=>b.message.order-a.message.order)[0];
}
function deliveryAlert(){const issue=deliveryIssue();if(!issue)return '';const agent=agentFor(issue.conv);return `<div class="delivery-problem" role="status"><div><strong>Your reply didn’t reach ${esc(agent.name)}.</strong><span>That session is no longer available. Your words are saved.</span></div><button id="recover-global">Review reply ${icon('arrow')}</button></div>`;}
function recoverIssue(){const issue=deliveryIssue();if(!issue)return;issue.message.issueHandled=true;state.newDraft={text:issue.message.text,endpointId:issue.conv.endpointId,includeContext:false};save();go('new');}
function deliveryHTML(conv){
 const message=conv.messages.filter(item=>item.author==='you').at(-1);if(!message||message.replied&&message.delivery==='received'||message.order===conv.messages[0].order&&conv.signalIds.length)return '';
 const agent=agentFor(conv),label=message.delivery==='queued'?`Queued for ${agent.locationLabel}`:message.delivery==='failed'?'Couldn’t reach this session':'Received by '+agent.name;
 return `<div class="delivery-strip ${message.delivery}"><span class="delivery-status">${icon(message.delivery==='queued'?'clock':message.delivery==='failed'?'close':'check')} ${esc(label)}</span><p>${esc(message.text)}</p>${message.delivery==='queued'?'<small>Your reply is saved here. It will go through when MacBook reconnects.</small>':message.delivery==='failed'?`<small>${esc(message.failure)}</small><button class="text-action" id="recover-message">Start a new message ${icon('arrow')}</button>`:''}</div>`;
}
function historyHTML(conv){
 const draft=state.drafts[conv.id];
 return `<section class="conversation-history" id="conversation-history"><div class="history-heading"><span>CONVERSATION / ${conv.messages.length} MESSAGES</span><button id="close-history" aria-label="Close conversation">×</button></div><div class="timeline">${conv.messages.map(message=>`<article class="timeline-message ${message.author}"><div><span>${message.author==='you'?'YOU':message.author==='system'?'UPDATE':esc(agentFor(conv).name.toUpperCase())}</span><span>${message.origin?`FROM ${esc(message.origin.toUpperCase())}`:message.artifactVersion?`VERSION ${message.artifactVersion}`:message.revision?`UPDATE ${message.revision}`:message.delivery==='queued'?'QUEUED':''}</span></div>${message.title?`<h2>${esc(message.title)}</h2>`:''}<p>${esc(message.text)}</p>${message.artifact?`<span class="timeline-artifact">${icon('expand')} ${message.artifact==='launch'?'Launch directions':message.artifact==='diff'?'Inbox changes':message.artifact==='itinerary'?'Kyoto field notes':'Preview'} · version ${message.artifactVersion||message.revision||1}</span>`:''}${message.contextSnapshot?`<details class="history-context"><summary>Context shared with this message</summary><p>${esc(message.contextSnapshot)}</p></details>`:''}</article>`).join('')}</div>${draft?.text?`<div class="saved-draft"><span>DRAFT / NOT SENT</span><p>${esc(draft.text)}</p></div>`:''}</section>`;
}
function changeHTML(signal,conv){
 const draft=state.drafts[conv.id],stale=draft&&draft.signalId===signal.id&&draft.revision!==signal.revision;
 if(signal.state==='withdrawn'||signal.state==='expired')return `<div class="change-notice closed" role="status">${icon(signal.state==='expired'?'clock':'check')}<div><strong>${signal.state==='expired'?'This request expired.':'No longer needed.'}</strong><span>${esc(signal.reason)}${draft?.text?' Your unsent draft is saved in Conversation.':''}</span></div></div>`;
 if(signal.answeredElsewhere)return `<div class="change-notice" role="status">${icon('check')}<div><strong>Answered on your iPhone.</strong><span>${draft?.text?'Your unsent draft is saved in Conversation.':'The recorded answer is here in the conversation.'}</span></div></div>`;
 if(signal.updated)return `<div class="change-notice" role="status">${icon('clock')}<div><strong>Updated by ${esc(agentFor(conv).name)}.</strong><span>${stale?'Your draft is saved. Review the new request before sending.':'A little has changed. Take another look before deciding.'}</span></div>${stale?'<button id="review-update">I’ve reviewed it</button>':''}</div>`;
 return '';
}
function controlsHTML(signal,conv){
 const access=replyAvailability(state,signal,device),paused=state.paused.includes(conv.endpointId);
 if(paused)return `<div class="response-summary"><span class="action-caption">CONNECTION PAUSED</span><p>Resume this connection to reply.</p><button class="text-action" data-route="connections">Open Connections ${icon('arrow')}</button></div>`;
 if(['withdrawn','expired'].includes(signal.state))return `<div class="response-summary"><span class="action-caption">ON YOUR TIME</span><p>The conversation is still here.</p>${action('Back to inbox','back-inbox',false)}</div>`;
 if(signal.state==='answered')return `<div class="response-summary"><span class="action-caption">${icon('check')} RESPONSE RECORDED</span>${action('Next signal','next-signal',false)}<span class="action-detail">Your response is saved here.</span></div>`;
 if(signal.kind==='result')return `<span class="action-caption">ON YOUR TIME</span>${action('Done','clear-result',true,'1')}${action(state.drafts[conv.id]?.text?'Resume reply':'Reply','open-reply',false,'2')}<p class="action-detail">${access.queued?`Replies can wait for ${esc(agentFor(conv).locationLabel)}.`:'Reply if you want to keep it going.'}</p>`;
 if(signal.kind==='review')return `<span class="action-caption">DIRECTION / <span class="selected-direction">${state.direction==='volt'?'Volt':'Type'}</span></span>${action(`Use ${state.direction==='volt'?'Volt':'Type'}`,'respond',true,'1')}${action('Give feedback','feedback',false,'2')}<p class="action-detail">A direction. No publishing yet.</p>`;
 if(signal.kind==='approval')return `<div class="approval-terms"><span class="action-caption">YOU’RE APPROVING</span><strong>One staging deployment</strong><span>Volt · Somae launch</span><small>Production is not included.</small></div>${action('Approve staging','respond',true,'1')}${action('Not yet','decline',false,'2')}<button class="text-action ask-question" id="ask-question">Ask a question instead</button>`;
 return `${action('Two hours of focus','focus-choice',true,'1')}${action('Something else','open-reply',false,'2')}<p class="action-detail">A suggestion. Your calendar stays as it is.</p>`;
}
function replyHTML(signal,conv){
 if(!replyMode)return '';
 const draft=state.drafts[conv.id],text=draft?.text||'',stale=draft&&draft.signalId===signal.id&&draft.revision!==signal.revision,access=replyAvailability(state,signal,device);
 const caption=replyMode==='ask'?'ASK A QUESTION / THIS DOES NOT APPROVE':replyMode==='feedback'?'FEEDBACK FOR '+agentFor(conv).name.toUpperCase():'REPLY TO '+agentFor(conv).name.toUpperCase();
 return `<form class="conversation-reply" id="conversation-reply"><div class="reply-dock-head"><label for="reply">${caption}</label><button type="button" id="close-reply" aria-label="Close reply draft">×</button></div><textarea id="reply" rows="2" maxlength="4000" placeholder="${replyMode==='feedback'?'What should change?':'A thought to keep it going…'}">${esc(text)}</textarea><div class="reply-dock-bottom"><span id="reply-draft-status">${stale?'Review the update to send.':text.trim()?'Draft saved':'⌘ ↵ to send'}</span><button class="send-thought" id="reply-send" ${!text.trim()||stale||!access.allowed?'disabled':''}>${access.queued?'Queue reply':'Send'} ${icon('up')}</button></div></form>`;
}
function moment(){
 const conv=conversation();if(!conv)return inbox();
 const signal=current();
 if(!signal)return `<div class="message-waiting">${sourceHTML(conv)}<span class="eyebrow">YOUR MESSAGE</span><h1 tabindex="-1">A thought, sent.</h1><p>Your conversation with ${esc(agentFor(conv).name)} is here. Their reply will find you.</p></div>`;
 const readonly=['withdrawn','expired'].includes(signal.state),type=signal.kind==='review'?'review':signal.kind==='result'?'agent-result':signal.kind;
 return `${changeHTML(signal,conv)}<div class="decision ${type} ${readonly?'closed-signal':''}"><div>${sourceHTML(conv,signal)}<span class="moment-kind">${signal.kind==='result'?`RESULT${signal.version?` / ${String(signal.version).padStart(2,'0')}`:''}`:signal.kind==='approval'?'APPROVAL':signal.state==='active'?'NEEDS YOU':'CONVERSATION'}</span><h1 tabindex="-1">${esc(signal.title)}</h1><p class="request-copy">${esc(signal.copy)}</p>${signal.kind==='result'?`<p class="request-context"><span>You asked</span>${esc(conv.messages.find(message=>message.author==='you')?.text||conv.title)}</p>`:''}${signal.artifact?`<button class="preview-link" id="preview" aria-expanded="${canvasOpen}">${icon('expand')} ${canvasOpen?'Close preview':signal.artifact==='launch'?'Open the directions':signal.artifact==='diff'?'See the changes':signal.artifact==='itinerary'?'Open the field notes':'Open the preview'} <kbd>P</kbd></button>`:''}</div><div class="decision-actions">${controlsHTML(signal,conv)}${signal.state==='active'&&!state.paused.includes(conv.endpointId)?'<p class="option-hint">↑ ↓ to move <span>·</span> ↵ to choose</p>':''}</div></div>`;
}
function composer(){
 const draft=state.newDraft,target=agentById(draft.endpointId),available=endpointAvailability(state,draft.endpointId,device);
 if(picking){const rows=agents.filter(agent=>state.connected.includes(agent.id)),ready=rows.filter(agent=>endpointAvailability(state,agent.id,device).allowed),blocked=rows.filter(agent=>!endpointAvailability(state,agent.id,device).allowed);const row=agent=>{const access=endpointAvailability(state,agent.id,device);return `<button class="endpoint-option ${access.allowed?'':'unavailable'}" data-endpoint="${agent.id}" aria-disabled="${!access.allowed}">${senderIcon(agent.name)}<span class="endpoint-copy"><strong>${agent.name}<small>${locationName(agent)}</small></strong><span>${esc(access.allowed?agent.role:access.reason)}</span></span><span class="endpoint-state">${access.allowed?icon('arrow'):esc(access.label)}</span></button>`;};return `<section class="utility-page agent-picker">${utilityHead('TO','Who’s it for?','Your agents, wherever they work.')}<div class="endpoint-group"><h2>Ready here</h2>${ready.map(row).join('')}</div>${blocked.length?`<details class="unavailable-agents"><summary>${blocked.length} unavailable destination${blocked.length===1?'':'s'}</summary>${blocked.map(row).join('')}</details>`:''}<p class="endpoint-rule">Local messages start on their own computer. Existing replies can travel with you.</p><button class="text-action" data-route="connections">Connect another agent ${icon('plus')}</button></section>`;}
 return `<section class="utility-page message-compose">${utilityHead('NEW MESSAGE','What’s on your mind?')}<form id="new-message-form"><label class="sr-only" for="message-text">Your message</label><textarea id="message-text" class="message-text" maxlength="4000" rows="4" placeholder="An idea. A question. Something to make.">${esc(draft.text)}</textarea><div class="message-routing"><span class="message-field-label">TO</span><button type="button" id="choose-agent" class="destination" aria-label="${target?'Change destination, '+target.name:'Choose an agent'}">${target?`${senderIcon(target.name)}<span><strong>${target.name}</strong><small>${locationName(target)}</small></span>`:`<span class="destination-empty">${icon('plus')}</span><span>Choose an agent</span>`}${icon('down')}</button></div>${target?.host==='local'?`<p class="message-workspace">Workspace <strong>somae</strong><span>on MacBook</span></p>`:''}${target&&!available.allowed?`<p class="message-warning" role="status">${esc(available.reason)}</p>`:''}<label class="message-context"><input type="checkbox" id="include-message-context" ${draft.includeContext?'checked':''}><span>Include my saved context</span><span class="optional-label">Optional</span></label>${draft.includeContext?`<details class="context-disclosure"><summary>See what will be shared</summary><p>${esc(state.context)}</p></details>`:''}<div class="message-compose-bottom"><span>Your draft stays here until you send.</span><button class="action primary" id="send-message" ${!draft.text.trim()||!available.allowed?'disabled':''}><span>Send</span>${icon('arrow')}</button></div></form></section>`;
}
function connections(){return `<section class="utility-page connections-page">${utilityHead('YOUR SPACE','One address.<br>Your agents.','A connection lets an agent reach you, on your terms.')}<div class="handle-card"><div><span>YOUR SOMAE HANDLE</span><strong>${esc(state.handle)}</strong></div><button id="copy-handle">Copy ${icon('arrow')}</button></div><div class="connections-heading"><span>CONNECTED / ${state.connected.length}</span><button data-route="connect-agent">Connect an agent ${icon('plus')}</button></div>${agents.filter(agent=>state.connected.includes(agent.id)).map(agent=>`<details class="connection-card"><summary>${senderIcon(agent.name)}<span><strong>${agent.name} <small>${locationName(agent)}</small></strong><span>${state.paused.includes(agent.id)?'Paused':agent.role}</span></span>${icon('down')}</summary><div class="connection-details"><p><span>Can send</span>Results, questions, and approval requests</p><p><span>Can receive</span>${agent.host==='local'?'New messages from MacBook; replies to this session from your devices':'New messages and replies from your devices'}</p><p><span>Context</span>Only what you choose to share</p><div><button data-pause="${agent.id}">${state.paused.includes(agent.id)?'Resume connection':'Pause connection'}</button><button class="disconnect" data-disconnect="${agent.id}">Disconnect</button></div></div></details>`).join('')}</section>`;}
function connectAgent(){const connected=state.connected.includes('north-hosted');return `<section class="utility-page">${utilityHead('CONNECT AN AGENT',connected?'North is connected.':'Make room for North.','A demo connection to your writing companion.')}<div class="connect-agent-identity">${senderIcon('North')}<div><strong>North</strong><span>Writing companion · Hosted</span></div></div><div class="connect-scope"><p>${icon('check')} Send results, questions, and previews</p><p>${icon('check')} Receive your messages and replies</p><p>${icon('close')} No automatic access to your saved context</p></div><p class="utility-copy">You can pause or disconnect this agent at any time.</p>${connected?action('Back to your agents','show-connections',true):action('Connect North','confirm-connect',true)}<p class="demo-disclosure">Local connection preview. No account is linked.</p></section>`;}
function utility(){
 if(mode==='clear'){const issue=deliveryIssue(),queued=Object.values(state.conversations).flatMap(conv=>conv.messages.map(message=>({...message,endpointId:conv.endpointId}))).filter(message=>message.delivery==='queued');const later=Object.values(state.signals).filter(signal=>signal.later).length;return `<div class="receipt clear-state"><div><span class="eyebrow">ROOM TO THINK</span><h1 tabindex="-1">${issue?'Your signals are clear.':'Nothing else needs you.'}</h1><p>${issue?'One reply wasn’t received. Review it above before sending again.':queued.length?`Your ${queued.length===1?'reply is':'replies are'} saved, waiting for MacBook.`:later?`${later} ${later===1?'signal is':'signals are'} set aside for later.`:'You’re all caught up.'}</p></div><div class="receipt-actions">${action('Get back to it','hide',true)}</div></div>`;}
 if(mode==='new')return composer();if(mode==='connections')return connections();if(mode==='connect-agent')return connectAgent();
 if(mode==='context')return `<section class="utility-page">${utilityHead('YOUR WORDS','Set the tone.','Saved by you. Shared when you choose.')}<label class="sr-only" for="context">Your saved context</label><textarea class="context-editor" id="context">${esc(contextDraft)}</textarea><div class="utility-save"><span>Each message shares a copy.<br>Earlier conversations keep what you shared then.</span>${action('Save context','save-context',true)}</div></section>`;
 if(mode==='materials')return `<section class="utility-page">${utilityHead('MAKE IT YOURS','Choose your frequency.','Same instrument. A different charge.')}<div class="material-options">${[['electric','Electric','INK / ACID'],['infrared','Infrared','OXIDE / HEAT'],['afterhours','After hours','PLUM / ULTRAVIOLET']].map(([id,label,sub])=>`<button class="material" data-material="${id}" aria-pressed="${state.material===id}"><span class="material-preview"></span><strong>${label}</strong><small>${sub}</small></button>`).join('')}</div></section>`;
 if(mode==='later')return `<section class="utility-page">${utilityHead('ON YOUR TIME','Set aside.','Your conversations stay here.')}<div>${Object.values(state.signals).filter(signal=>signal.later).map((signal,index)=>rowHTML({target:`moment/${signal.id}`,title:signal.title,sub:state.conversations[signal.conversationId].title,endpointId:state.conversations[signal.conversationId].endpointId,tag:badge(signal)},index)).join('')||'<p class="empty">Nothing set aside yet.</p>'}</div></section>`;
 return inbox();
}
function footer(){
 if(mode==='moment'){const conv=conversation(),signal=current(),queue=signalQueue(state),index=queue.findIndex(item=>item.id===currentId);return `<span class="foot-left"><span class="stepper"><button id="previous" aria-label="Previous signal" title="Previous signal · Left arrow">${icon('back')}</button><span>${index>=0?`${String(index+1).padStart(2,'0')} / ${String(queue.length).padStart(2,'0')}`:'PAST'}</span><button id="next" aria-label="Next signal" title="Next signal · Right arrow">${icon('next')}</button></span><span class="foot-divider"></span><button id="show-history" aria-expanded="${historyOpen}" aria-controls="conversation-history">${icon(historyOpen?'close':'plus')} ${historyOpen?'Close details':'Details'}</button></span><span class="foot-right">${signal?.state==='active'&&!signal.cleared?`<button id="later" title="Set aside / return to queue · ⌘ Left arrow" aria-keyshortcuts="Meta+ArrowLeft Control+ArrowLeft">${signal.later?'Return to queue':'Set aside'} <kbd>⌘ ←</kbd></button>`:''}<button id="hide">Hide <kbd>esc</kbd></button></span>`;}
 if(mode==='clear')return `<span class="foot-left"><button data-route="inbox">Inbox ${icon('arrow')}</button></span><span class="foot-right"><button data-route="connections">${esc(state.handle)}</button></span>`;
 if(mode==='inbox')return `<span class="foot-left"><span>↑ ↓ to move</span><span>↵ to open</span></span><span class="foot-right"><button data-route="connections">${esc(state.handle)}</button></span>`;
 if(mode==='new')return `<span class="foot-left"><button id="back">${icon('back')} ${picking?'Back to your draft':'Inbox'}</button></span><span class="foot-right" id="message-draft-status">${state.newDraft.text.trim()?'Draft saved':'⌘ ↵ to send'}</span>`;
 return `<span class="foot-left"><button data-route="inbox">${icon('back')} Inbox</button></span><span class="foot-right"><button id="hide">Hide <kbd>esc</kbd></button></span>`;
}
function render({focus=true}={}){
 layout(()=>{const panel=$('#instrument');panel.classList.toggle('utility',mode!=='moment');panel.classList.toggle('wide',mode==='moment'&&canvasOpen);panel.classList.toggle('conversation-open',historyOpen);$('#delivery-alert').innerHTML=deliveryAlert();$('#view').innerHTML=mode==='moment'?moment():mode==='inbox'?inbox():utility();$('#instrument-foot').innerHTML=footer();renderCanvas();const conv=mode==='moment'?conversation():null;$('#reply-wrap').innerHTML=conv?(current()?deliveryHTML(conv)+replyHTML(current(),conv):deliveryHTML(conv)):'';$('#history-wrap').innerHTML=conv&&historyOpen?historyHTML(conv):'';bind();updateChrome();});
 animate($('#view'),[{opacity:.3,transform:'translateY(6px)'},{opacity:1,transform:'none'}],{duration:210});if(focus&&awake)focusView();
}
function artifactHTML(signal){
 if(signal.artifact==='diff')return `<div class="code-preview"><div class="artifact-meta"><span>SOMAE / INBOX CHANGES</span><span>3 FILES · +24 / −38</span></div><h2>A little less to look at.</h2><p>The inbox keeps the next decision close and lets the rest recede.</p><div class="diff-lines"><span class="removed">− One long list of everything</span><span class="added">+ Needs you · questions & approvals</span><span class="added">+ New · answers & artifacts</span><span class="added">+ Recent · conversations to return to</span></div><div class="artifact-footer"><span>Inbox.tsx</span><span>Styles.css</span><span>Signals.ts</span></div></div>`;
 if(signal.artifact==='itinerary')return `<div class="itinerary-preview"><div class="artifact-meta"><span>ORBIT FIELD NOTES / KYOTO</span><span>V${signal.version||1}</span></div><h2>Leave room<br>for the good bits.</h2><div class="itinerary-grid"><article><span>01 / STAY</span><h3>Higashiyama</h3><p>A quiet base. Early walks, small cafés, and a little distance from the rush.</p></article><article><span>02 / WANDER</span><h3>The eastern hills</h3><p>Take a slow morning from the canal to the little streets around Nanzen-ji.</p></article><article><span>03 / LINGER</span><h3>A market morning</h3><p>Go hungry. Keep the afternoon open. Follow whatever catches your attention.</p></article></div><div class="artifact-footer"><span>Illustrative travel notes</span><span>No bookings made</span></div></div>`;
 if(signal.artifact==='dayplan')return `<div class="dayplan-preview"><div class="artifact-meta"><span>DAYLIGHT / A SUGGESTION</span><span>NOT ADDED TO YOUR CALENDAR</span></div><h2>Give the morning<br>one good thing.</h2><div class="day-block"><span>09:00 — 11:00</span><strong>Room for focus</strong><p>Two hours, with the rest of the day left alone.</p></div></div>`;
 return `<div class="writing-preview"><span class="artifact-meta">NORTH / FIRST PASS</span><h2>A small gesture.<br>A whole language.</h2><p>Your agents, wherever they work. Your conversations, right here.</p></div>`;
}
function renderCanvas(){
 const wrap=$('#canvas-wrap'),signal=current(),show=mode==='moment'&&canvasOpen&&signal?.artifact;wrap.hidden=!show;
 if(!show){wrap.innerHTML='';wrap.scrollTop=0;delete wrap.dataset.key;return;}
 const agent=agentFor(conversation()),key=`${signal.id}:${signal.revision}:${signal.artifact}`;
 if(wrap.dataset.key!==key){wrap.scrollTop=0;wrap.dataset.key=key;wrap.innerHTML=`<div class="canvas-title"><span class="canvas-sender">${senderIcon(agent.name)} ${agent.name.toUpperCase()} / ${signal.artifact==='launch'?'INTERACTIVE DIRECTIONS':'PREVIEW'}</span><button id="close-canvas">Close canvas ×</button></div>${signal.artifact==='launch'?`<iframe id="launch-canvas" title="Interactive Somae launch directions" sandbox="allow-scripts" src="./canvases/launch.html?direction=${state.direction}&locked=${signal.state!=='active'?1:0}&revision=${signal.revision}"></iframe>`:artifactHTML(signal)}`;}
 const frame=$('#launch-canvas');if(frame){const sync=()=>frame.contentWindow.postMessage({type:'signal-canvas-lock',locked:signal.state!=='active'},'*');frame.onload=sync;sync();}
 on('#close-canvas',()=>{canvasOpen=false;render({focus:false});$('#preview')?.focus();});
}
function revealReply(){
 const panel=$('#instrument');
 Promise.allSettled(panel.getAnimations().map(animation=>animation.finished)).then(()=>requestAnimationFrame(()=>{
  const button=$('#reply-send');if(!button||!awake)return;
  const overlap=button.getBoundingClientRect().bottom-$('#instrument-foot').getBoundingClientRect().top+14;
  if(overlap>0)panel.scrollTop+=overlap;
 }));
}
function openReply(next='reply'){
 const signal=current();if(!signal)return;
 const access=replyAvailability(state,signal,device);if(!access.allowed){toast(access.reason);return;}
 replyMode=next;
 const draft=state.drafts[signal.conversationId];if(!draft)saveDraft(state,signal,'',next);else draft.mode=next;
 save();render({focus:false});$('#reply')?.focus({preventScroll:true});$('#conversation-reply')?.scrollIntoView({block:'nearest'});revealReply();
}
function send(text,{decision=false,mode:submitMode=replyMode||'reply'}={}){
 const signal=current(),draft=state.drafts[signal.conversationId],before=signalQueue(state);
 const result=submitResponse(state,signal.id,{text,revision:decision?signal.revision:draft?.revision||signal.revision,device,decision,mode:submitMode});
 if(!result.ok){toast(result.reason);render({focus:false});$('#reply')?.focus();return;}
 replyMode='';save();toast(result.message.delivery==='queued'?`Reply queued for ${agentFor(result.conversation).locationLabel}.`:'Reply received.');advanceFrom(signal.id,before);
}
function bindRows(){for(const button of $$('[data-result]')){button.onclick=()=>activate(button.dataset.target);button.onpointerenter=()=>selectResult(Number(button.dataset.result));button.onfocus=()=>selectResult(Number(button.dataset.result));}}
function selectResult(index){activeResult=index;for(const button of $$('[data-result]')){const selected=Number(button.dataset.result)===index;button.classList.toggle('selected',selected);button.querySelector('kbd')?.remove();if(selected){const key=document.createElement('kbd');key.textContent='↵';button.append(key);}}}
function activate(target){if(target==='replay'){reset();return;}go(target);}
function bind(){
 for(const button of $$('[data-route]'))button.onclick=()=>go(button.dataset.route);bindRows();
 if($('#search'))$('#search').oninput=event=>{search=event.target.value;activeResult=0;$('#results').innerHTML=inboxBody();bindRows();};
 on('#source',()=>{const panel=$('#provenance');panel.hidden=!panel.hidden;$('#source').setAttribute('aria-expanded',String(!panel.hidden));});
 on('#preview',()=>{canvasOpen=!canvasOpen;render({focus:false});(canvasOpen?$('#close-canvas'):$('#preview'))?.focus({preventScroll:true});});
 on('#respond',()=>send(current().kind==='approval'?'Approved one staging deployment of Volt. No production publish.':`Use ${state.direction==='volt'?'Volt':'Type'} for the launch direction.`,{decision:true}));
 on('#decline',()=>send('Not yet. No staging deployment approved.',{decision:true}));
 on('#focus-choice',()=>send('Make room for two hours of focused work.',{decision:true}));
 on('#open-reply',()=>openReply());on('#feedback',()=>openReply('feedback'));on('#ask-question',()=>openReply('ask'));
 on('#close-reply',()=>{replyMode='';render({focus:false});$('#open-reply, #feedback')?.focus();});
 on('#review-update',()=>{reviewDraft(state,current());save();render({focus:false});$('#reply')?.focus();});
 if($('#reply'))$('#reply').oninput=event=>{saveDraft(state,current(),event.target.value,replyMode);save();const draft=state.drafts[current().conversationId],stale=draft.revision!==current().revision;$('#reply-send').disabled=!event.target.value.trim()||stale;$('#reply-draft-status').textContent=stale?'Review the update to send.':event.target.value.trim()?'Draft saved':'⌘ ↵ to send';};
 if($('#conversation-reply'))$('#conversation-reply').onsubmit=event=>{event.preventDefault();send($('#reply').value);};
 on('#show-history',()=>{historyOpen=!historyOpen;render({focus:false});if(historyOpen)$('#conversation-history')?.scrollIntoView({block:'nearest'});$('#show-history')?.focus({preventScroll:true});});
 on('#close-history',()=>{historyOpen=false;render({focus:false});$('#show-history')?.focus();});
 on('#back-inbox',()=>go(queueHome()));on('#previous',()=>step(-1));on('#next',()=>step(1));on('#next-signal',()=>advanceFrom(currentId));on('#clear-result',()=>{const before=signalQueue(state);clearResult(state,currentId);save();advanceFrom(currentId,before);});on('#later',setAside);
 on('#hide',()=>setAwake(false));on('#back',()=>{if(mode==='new'&&picking){picking=false;render();}else go(queueHome());});
 on('#choose-agent',()=>{picking=true;render();});
 for(const button of $$('[data-endpoint]'))button.onclick=()=>{const access=endpointAvailability(state,button.dataset.endpoint,device);if(!access.allowed){toast(access.reason);return;}state.newDraft.endpointId=button.dataset.endpoint;picking=false;save();render();};
 if($('#message-text'))$('#message-text').oninput=event=>{state.newDraft.text=event.target.value;save();$('#send-message').disabled=!event.target.value.trim()||!endpointAvailability(state,state.newDraft.endpointId,device).allowed;$('#message-draft-status').textContent=event.target.value.trim()?'Draft saved':'⌘ ↵ to send';updateChrome();};
 if($('#include-message-context'))$('#include-message-context').onchange=event=>{state.newDraft.includeContext=event.target.checked;save();render({focus:false});$('#include-message-context')?.focus();};
 if($('#new-message-form'))$('#new-message-form').onsubmit=event=>{event.preventDefault();const result=startMessage(state,{...state.newDraft,device});if(!result.ok){toast(result.reason);return;}save();toast(`Message received by ${agentFor(result.conversation).name}.`);go(queueHome());};
 on('#recover-global',recoverIssue);on('#recover-message',()=>{state.newDraft={text:conversation().messages.filter(item=>item.author==='you').at(-1).text,endpointId:conversation().endpointId,includeContext:false};save();go('new');});
 if($('#context'))$('#context').oninput=event=>{contextDraft=event.target.value;};on('#save-context',()=>{state.context=contextDraft;save();toast('Context saved. Earlier messages keep their shared copy.');});
 for(const button of $$('.material[data-material]'))button.onclick=()=>{state.material=button.dataset.material;document.documentElement.dataset.material=state.material;save();render({focus:false});$(`.material[data-material="${state.material}"]`)?.focus();};
 on('#copy-handle',async()=>{try{await navigator.clipboard.writeText(state.handle);toast('Handle copied.');}catch{toast(`Your handle is ${state.handle}`);}});
 for(const button of $$('[data-pause]'))button.onclick=()=>{const id=button.dataset.pause;state.paused=state.paused.includes(id)?state.paused.filter(item=>item!==id):[...state.paused,id];save();render({focus:false});$(`[data-pause="${id}"]`)?.focus();};
 for(const button of $$('[data-disconnect]'))button.onclick=()=>{const id=button.dataset.disconnect;state.connected=state.connected.filter(item=>item!==id);for(const signal of Object.values(state.signals))if(state.conversations[signal.conversationId].endpointId===id&&signal.state==='active'){signal.state='withdrawn';signal.reason='You disconnected this agent.';}save();render({focus:false});toast('Disconnected. Your conversations stay here.');};
 on('#confirm-connect',()=>{state.connected.push('north-hosted');save();go('connections');toast('North is connected in this demo.');});on('#show-connections',()=>go('connections'));
}
function reset(){const preferences={material:state.material,context:state.context};state=createState(preferences);contextDraft=state.context;canvasOpen=false;historyOpen=false;replyMode='';save();go(queueHome());toast('Four fresh signals.');}
function readRoute(){
 let [route,id]=location.hash.slice(1).split('/');
 if(['find','history','activity','task','sent'].includes(route)){route='inbox';history.replaceState(null,'',`${location.search}#inbox`);}
 const changedView=route!==mode||id!==currentId;
 const nextMode=['new','connections','connect-agent','context','materials','later','clear'].includes(route)?route:route==='moment'&&(state.signals[id]||state.conversations[id])?'moment':route==='inbox'?'inbox':signalQueue(state).length?'moment':'clear';
 if(nextMode!==mode||id!==currentId){canvasOpen=false;historyOpen=false;replyMode='';picking=false;search='';activeResult=0;}
 mode=nextMode;if(mode==='moment'){currentId=id&&(state.signals[id]||state.conversations[id])?id:signalQueue(state)[0]?.id;const signal=current();if(signal){signal.unread=false;save();}}
 document.documentElement.dataset.material=state.material;render();if(changedView)$('#instrument').scrollTop=0;if(!awake)setAwake(true);
}
function runScenario(value){
 if(value==='approval'){const signal=addApproval(state);save();go(`moment/${signal.id}`);return;}
 if(value==='offline'||value==='online'){setOnline(state,'codex-macbook',value==='online');save();if(value==='offline'&&(mode!=='moment'||conversation()?.endpointId!=='codex-macbook'))go('moment/local-layout');else render({focus:false});toast(value==='offline'?'Demo MacBook is offline. Replies can queue.':'Demo MacBook reconnected. Queued replies were received.');return;}
 if(value==='connect'){go('connect-agent');return;}
 if(value==='replay'){reset();return;}
 if(value==='failed'){const outbound=state.lastOutbound,conv=state.conversations[outbound?.conversationId],message=conv?.messages.find(item=>item.id===outbound.messageId);if(!message){toast('Send a reply first.');return;}message.delivery='failed';message.failure='The agent session is no longer available.';save();render({focus:false});return;}
 if(['updated','withdrawn','answered','expired'].includes(value)){const signal=current();if(!signal){toast('Open a signal first, then choose a state.');return;}const before=signalQueue(state),result=simulateSignalState(state,signal.id,value);if(!result.ok){toast(result.reason);return;}if(['withdrawn','answered','expired'].includes(value)){replyMode='';save();toast(value==='answered'?'Answered on your iPhone.':value==='expired'?'That request expired.':'No longer needed. Your draft is saved.');advanceFrom(signal.id,before);}else{save();render({focus:false});}}
}
window.addEventListener('hashchange',readRoute);
window.addEventListener('message',event=>{
 const frame=$('#launch-canvas');if(!frame||event.source!==frame.contentWindow||document.querySelector('dialog[open]'))return;
 if(event.data?.type==='signal-shortcut'){if(event.data.action==='previous-option')moveOption(-1);else if(event.data.action==='next-option')moveOption(1);else if(event.data.action==='option-1')chooseOption('1');else if(event.data.action==='option-2')chooseOption('2');else if(event.data.action==='set-aside')setAside();else if(event.data.action==='previous-signal')step(-1);else if(event.data.action==='next-signal')step(1);else if(event.data.action==='find')go('inbox');else if(event.data.action==='new-message')go('new');else if(event.data.action==='close'){canvasOpen=false;render({focus:false});$('#preview')?.focus();}return;}
 if(event.data?.type==='signal-direction'&&['volt','type'].includes(event.data.direction)&&current()?.state==='active'){
  state.direction=event.data.direction;save();$('.selected-direction')?.replaceChildren(document.createTextNode(state.direction==='volt'?'Volt':'Type'));if(current().kind==='review')$('#respond .action-label').textContent=`Use ${state.direction==='volt'?'Volt':'Type'}`;
 }
});
document.addEventListener('keydown',event=>{
 if(document.querySelector('dialog[open]')){if((event.metaKey||event.ctrlKey)&&['k','n'].includes(event.key.toLowerCase()))event.preventDefault();return;}if(event.repeat)return;
 if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='n'){event.preventDefault();go('new');return;}
 if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(!awake)summon();else go(mode==='inbox'?(signalQueue(state).some(signal=>signal.id===currentId)?`moment/${currentId}`:queueHome()):'inbox');return;}
 const editing=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)||document.activeElement?.isContentEditable;
 if(awake&&mode==='moment'&&!editing&&!event.altKey&&!event.shiftKey&&(event.metaKey||event.ctrlKey)&&event.key==='ArrowLeft'){event.preventDefault();setAside();return;}
 if(mode==='inbox'&&(document.activeElement===$('#search')||$('#results')?.contains(document.activeElement))&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();const rows=inboxRows();activeResult=(activeResult+(event.key==='ArrowDown'?1:-1)+rows.length)%Math.max(1,rows.length);selectResult(activeResult);$(`[data-result="${activeResult}"]`)?.scrollIntoView({block:'nearest'});return;}
 if(mode==='inbox'&&event.key==='Enter'&&document.activeElement===$('#search')){event.preventDefault();const row=inboxRows()[activeResult];if(row)activate(row.target);return;}
 if(editing&&(event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();document.activeElement.closest('form')?.requestSubmit();return;}
 if(event.key==='Escape'&&$('.lab-design')?.open){event.preventDefault();$('.lab-design').open=false;$('.lab-design summary').focus();return;}
 if(event.key==='Escape'){event.preventDefault();if(!awake){summon();return;}if(editing&&document.activeElement!==$('#search')){document.activeElement.blur();return;}if(mode==='new'&&picking){picking=false;render();return;}if(replyMode){replyMode='';render({focus:false});$('#open-reply,#feedback')?.focus();return;}if(canvasOpen){canvasOpen=false;render({focus:false});$('#preview')?.focus();return;}if(historyOpen){historyOpen=false;render({focus:false});$('#show-history')?.focus();return;}if(mode==='moment'||mode==='clear'||mode==='inbox'){setAwake(false);return;}go(queueHome());return;}
 if(editing||event.metaKey||event.ctrlKey||event.altKey)return;
 if(!awake){if(event.key===' '){event.preventDefault();summon();}return;}
 if(mode==='moment'&&!replyMode&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();moveOption(event.key==='ArrowDown'?1:-1);return;}
 if(mode==='moment'&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();step(event.key==='ArrowLeft'?-1:1);return;}
 if(mode==='moment'&&event.key.toLowerCase()==='p'){event.preventDefault();$('#preview')?.click();}
 if(mode==='moment'&&event.key.toLowerCase()==='r'){event.preventDefault();$('#open-reply,#feedback,#ask-question')?.click();}
 if(mode==='moment'&&event.key.toLowerCase()==='h'){event.preventDefault();$('#show-history')?.click();}
 if(mode==='moment'&&['1','2'].includes(event.key)){event.preventDefault();chooseOption(event.key);}

});
on('#home',()=>go(queueHome()));on('#find',()=>go('inbox'));on('#new-message',()=>go('new'));on('#dismiss',()=>setAwake(false));on('#beacon',summon);on('#summon',summon);
on('#help',()=>$('#keys').showModal());on('#close-keys',()=>$('#keys').close());
$('#preview-device').onchange=event=>{device=demoDevices.find(item=>item.id===event.target.value)||demoDevices[0];const url=new URL(location.href);url.searchParams.set('device',device.id);history.replaceState(null,'',url);render({focus:false});toast(`Previewing Somae on ${device.name}.`);};
$('#preview-scenario').onchange=event=>{runScenario(event.target.value);event.target.value='default';};
on('#sample-signal',()=>{const result=simulateReply(state,state.lastOutbound?.conversationId);if(!result.ok){toast(result.reason);return;}save();go(`moment/${result.signal.id}`);});
save();readRoute();
