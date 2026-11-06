import { getMessageAvailability } from './message-model.js';

export const agents = Object.freeze([
  { id:'claude-hosted', name:'Claude', host:'hosted', role:'Coding companion', model:'hosted-coding', locationLabel:'Hosted', available:true, connected:true, canReceiveMessages:true, project:'Somae launch' },
  { id:'codex-macbook', name:'Codex', host:'local', deviceId:'macbook', role:'Coding companion', model:'local-coding', locationLabel:'MacBook', available:true, connected:true, canReceiveMessages:true, project:'somae' },
  { id:'orbit-hosted', name:'Orbit', host:'hosted', role:'Research companion', model:'turn-based', locationLabel:'Hosted', available:true, connected:true, canReceiveMessages:true, project:'Japan trip' },
  { id:'daylight-hosted', name:'Daylight', host:'hosted', role:'Personal assistant', model:'durable', locationLabel:'Hosted', available:true, connected:true, canReceiveMessages:true, project:'Tomorrow' },
  { id:'north-hosted', name:'North', host:'hosted', role:'Writing companion', model:'turn-based', locationLabel:'Hosted', available:true, connected:true, canReceiveMessages:true, project:'A new idea' }
]);
export const agentById = id => agents.find(agent => agent.id === id);
const uid = prefix => `${prefix}-${crypto.randomUUID()}`;
const emptyDraft = () => ({text:'',endpointId:'',includeContext:false});
function append(state, conversation, message) {
  const record = { id:uid('message'), order:++state.order, ...message };
  conversation.messages.push(record);
  conversation.order = record.order;
  return record;
}
function seedConversation(state, id, endpointId, title, request, signal) {
  const conversation = {id,endpointId,title,signalIds:[],messages:[],order:0};
  state.conversations[id] = conversation;
  append(state,conversation,{author:'you',text:request,delivery:'received'});
  publish(state,conversation,signal,{unread:signal.requiresResponse !== true});
}
export function createState(preferences={}) {
  const state = {
    schema:2,order:0,material:['electric','infrared','afterhours'].includes(preferences.material)?preferences.material:'electric',
    direction:'volt',handle:'@scott',context:typeof preferences.context==='string'?preferences.context:'Keep the ask small. Give me the tradeoff.\n\nAsk before publishing, booking, or changing my calendar.',
    connected:agents.slice(0,4).map(agent=>agent.id),paused:[],offline:[],conversations:{},signals:{},drafts:{},newDraft:{...emptyDraft(),...(preferences.messageDraft||{})},lastOutbound:null
  };
  if(typeof state.newDraft.text!=='string')state.newDraft.text='';
  if(!agentById(state.newDraft.endpointId))state.newDraft.endpointId='';
  state.newDraft.includeContext=state.newDraft.includeContext===true;
  seedConversation(state,'launch','claude-hosted','Somae launch','Explore a bold direction for Somae. Show me a couple of options.',{
    id:'launch',kind:'review',requiresResponse:true,title:'Go loud?',copy:'Two directions for the launch. One refuses to blend in.',artifact:'launch',scope:'May share design reviews. Publishing needs your approval.'
  });
  seedConversation(state,'local-layout','codex-macbook','A lighter inbox','Make the inbox easier to scan. Keep the widget small.',{
    id:'local-layout',kind:'result',requiresResponse:false,title:'Less noise. More room.',copy:'The inbox is simpler. Needs you and new results each have a little room of their own.',artifact:'diff',scope:'This Mac · somae workspace. Your reply continues this session.'
  });
  seedConversation(state,'trip','orbit-hosted','A week in Kyoto','Find a quieter way to spend a week in Kyoto. I like walking, good food, and leaving some space.',{
    id:'trip',kind:'result',requiresResponse:false,title:'A quieter kind of Kyoto.',copy:'Three places to linger. One neighborhood to call home. Enough space to find something unexpected.',artifact:'itinerary',scope:'May research and share recommendations. Cannot make bookings.'
  });
  seedConversation(state,'focus','daylight-hosted','Tomorrow','Help me make room for focused work tomorrow.',{
    id:'focus',kind:'question',requiresResponse:true,title:'What gets your best hours?',copy:'Tomorrow is getting full. Tell me one thing to make room for.',artifact:null,scope:'May suggest changes. Calendar changes need your approval.'
  });
  return state;
}
export function restoreState(saved, preferences={}) {
  if(!saved||saved.schema!==2||!saved.conversations||!saved.signals||!Array.isArray(saved.connected))return createState(preferences);
  const state=structuredClone(saved);
  state.drafts ||= {}; state.offline ||= []; state.paused ||= []; state.newDraft ||= emptyDraft();
  return state;
}
export function publish(state, conversation, fields, {unread=true}={}) {
  const signal = { id:fields.id||uid('signal'),conversationId:conversation.id,revision:1,state:'active',unread,later:false,updated:false,...fields };
  const record=append(state,conversation,{author:'agent',text:signal.copy,title:signal.title,artifact:signal.artifact,artifactVersion:signal.version||signal.revision,signalId:signal.id,revision:signal.revision});
  signal.messageId=record.id;signal.order=record.order;
  state.signals[signal.id]=signal;
  conversation.signalIds.push(signal.id);
  conversation.latestSignalId=signal.id;
  return signal;
}
export const conversationFor = (state, signal) => state.conversations[signal?.conversationId];
export const latestSignal = (state, conversation) => state.signals[conversation.latestSignalId];
export function attention(state) {
  const current=Object.values(state.conversations).map(conversation=>latestSignal(state,conversation)).filter(Boolean);
  return {
    needs:Object.values(state.signals).filter(signal=>signal.requiresResponse&&signal.state==='active'&&!signal.later&&!state.paused.includes(conversationFor(state,signal).endpointId)),
    fresh:current.filter(signal=>!signal.requiresResponse&&signal.state==='active'&&signal.unread&&!signal.cleared&&!signal.later),
    recent:Object.values(state.conversations).sort((a,b)=>b.order-a.order)
  };
}
export function signalQueue(state) {
  const latestResults=new Set(Object.values(state.conversations).map(conversation=>conversation.latestSignalId));
  return Object.values(state.signals).filter(signal=>signal.state==='active'&&!signal.cleared&&!signal.later&&state.connected.includes(conversationFor(state,signal).endpointId)&&!state.paused.includes(conversationFor(state,signal).endpointId)&&(signal.requiresResponse||latestResults.has(signal.id))).sort((a,b)=>(a.order||0)-(b.order||0));
}
export function clearResult(state,signalId) {
  const signal=state.signals[signalId];
  if(!signal||signal.requiresResponse||signal.state!=='active')return false;
  signal.cleared=true;signal.unread=false;return true;
}
export function endpointAvailability(state, endpointId, device) {
  const agent=agentById(endpointId);
  if(!agent)return {allowed:false,label:'Unavailable',reason:'This agent is unavailable.'};
  return getMessageAvailability({...agent,connected:state.connected.includes(agent.id),available:!state.offline.includes(agent.id)}, {device,paused:state.paused});
}
export function replyAvailability(state, signal, device) {
  const conversation=conversationFor(state,signal),agent=agentById(conversation?.endpointId);
  if(!device?.id||!['desktop','mobile'].includes(device.kind))return {allowed:false,reason:'This device is not recognized.'};
  if(!agent||!state.connected.includes(agent.id))return {allowed:false,reason:'This agent is not connected.'};
  if(state.paused.includes(agent.id))return {allowed:false,reason:`Resume ${agent.name} in Connections to reply.`};
  if(signal.state==='withdrawn'||signal.state==='expired')return {allowed:false,reason:'This request is no longer available.'};
  if(agent.host==='local'&&signal.state!=='active')return {allowed:false,reason:'Wait for a new reply from Codex, or start a message on MacBook.'};
  return {allowed:true,queued:state.offline.includes(agent.id),reason:state.offline.includes(agent.id)?`Queued for ${agent.locationLabel}`:'Reply in this conversation'};
}
export function saveDraft(state,signal,text,mode='reply') {
  const conversation=conversationFor(state,signal),existing=state.drafts[conversation.id];
  state.drafts[conversation.id]={text,mode,signalId:signal.id,revision:existing?.signalId===signal.id?existing.revision:signal.revision};
}
export function reviewDraft(state,signal) {
  const draft=state.drafts[signal.conversationId];
  if(draft){draft.signalId=signal.id;draft.revision=signal.revision;}
}
export function submitResponse(state,signalId,{text,revision,device,decision=false,mode='reply'}={}) {
  const signal=state.signals[signalId];
  if(!signal)return {ok:false,code:'unavailable',reason:'This signal is unavailable.'};
  const access=replyAvailability(state,signal,device);
  if(!access.allowed)return {ok:false,code:signal.state,reason:access.reason};
  if(revision!==signal.revision)return {ok:false,code:'stale',reason:'This request changed. Review the update; your draft is saved.'};
  if((decision||mode==='reply')&&signal.state!=='active')return {ok:false,code:'answered',reason:'This request has already been answered.'};
  const value=String(text||'').trim();
  if(!value)return {ok:false,code:'empty',reason:'Write a reply first.'};
  const conversation=conversationFor(state,signal);
  const terminal=mode!=='ask'&&signal.state==='active';
  const message=append(state,conversation,{author:'you',text:value,delivery:access.queued?'queued':'received',signalId:signal.id,signalRevision:signal.revision,decision,terminal});
  if(terminal){signal.state='answered';signal.responseId=message.id;signal.answer=value;}
  signal.unread=false;
  delete state.drafts[conversation.id];
  state.lastOutbound={conversationId:conversation.id,messageId:message.id};
  return {ok:true,message,conversation};
}
export function startMessage(state,{endpointId,text,includeContext=false,device}={}) {
  const access=endpointAvailability(state,endpointId,device);
  if(!access.allowed)return {ok:false,reason:access.reason};
  const value=String(text||'').trim();
  if(!value)return {ok:false,reason:'Write a message first.'};
  const conversation={id:uid('conversation'),endpointId,title:value.length>46?`${value.slice(0,43)}…`:value,signalIds:[],messages:[],order:0};
  state.conversations[conversation.id]=conversation;
  const message=append(state,conversation,{author:'you',text:value,delivery:'received',contextSnapshot:includeContext?state.context:null});
  state.lastOutbound={conversationId:conversation.id,messageId:message.id};
  state.newDraft={...emptyDraft(),endpointId};
  return {ok:true,conversation,message};
}
export function simulateReply(state,conversationId) {
  const conversation=state.conversations[conversationId];
  if(!conversation)return {ok:false,reason:'Open a conversation first.'};
  const agent=agentById(conversation.endpointId);
  if(state.paused.includes(agent.id)||!state.connected.includes(agent.id))return {ok:false,reason:'This connection is paused or disconnected.'};
  if(state.offline.includes(agent.id))return {ok:false,reason:`${agent.locationLabel} is offline. Reconnect the demo bridge first.`};
  const pending=conversation.messages.filter(message=>message.author==='you'&&!message.replied);
  const message=pending.at(-1);
  if(!message)return {ok:false,reason:'Send a message or reply first.'};
  if(message.delivery==='failed')return {ok:false,reason:'This session is no longer available. Start a new message to continue.'};
  pending.forEach(item=>{item.replied=true;item.delivery='received';});
  const previous=latestSignal(state,conversation);
  // Answering a clarification does not silently resolve a pending approval.
  const version=conversation.signalIds.length+1;
  const fields = agent.id==='codex-macbook'
    ? {title:'A little tighter.',copy:'The spacing is more deliberate now. I kept the inbox compact and made the important rows easier to find.',artifact:'diff'}
    : agent.id==='claude-hosted'
    ? {title:'Here’s the next direction.',copy:'A calmer composition, with a stronger first impression. The new preview keeps the idea front and center.',artifact:'launch'}
    : agent.id==='daylight-hosted'
    ? {title:'A little room, found.',copy:'There’s a quiet window from 9 to 11. Here’s the suggestion; nothing has moved on your calendar.',artifact:'dayplan'}
    : agent.id==='north-hosted'
    ? {title:'An opening to build on.',copy:'A short first pass, with room for your voice. Tell me what should change.',artifact:'writing'}
    : {title:version>1?'More wandering. Less rushing.':'A little space to explore.',copy:'Two gentle walks, a small market, and a neighborhood worth getting lost in. I left the afternoons open.',artifact:'itinerary'};
  const signal=publish(state,conversation,{...fields,kind:'result',requiresResponse:false,version,scope:previous?.scope||'Connected by you. Context is shared only when you choose.'},{unread:true});
  return {ok:true,signal,conversation};
}
export function setOnline(state,endpointId,online) {
  state.offline=online?state.offline.filter(id=>id!==endpointId):[...new Set([...state.offline,endpointId])];
  if(online&&state.connected.includes(endpointId)&&!state.paused.includes(endpointId)){
    for(const conversation of Object.values(state.conversations).filter(item=>item.endpointId===endpointId)){
      for(const message of conversation.messages)if(message.delivery==='queued')message.delivery='received';
    }
  }
}
export function simulateSignalState(state,signalId,event) {
  const signal=state.signals[signalId],conversation=conversationFor(state,signal);
  if(!signal||!conversation)return {ok:false,reason:'Open a signal to try this state.'};
  if(event==='updated'){
    if(signal.state!=='active')return {ok:false,reason:'This signal already has a response. Replay the demo to try an update.'};
    signal.revision++;signal.updated=true;
    signal.title=signal.kind==='review'?'A softer kind of loud.':'One detail changed.';
    signal.copy=signal.kind==='review'?'The second direction is quieter now. Your original choices are still here; review the new preview before deciding.':'The agent has updated this request. Take another look before sending your answer.';
    const message=append(state,conversation,{author:'agent',title:signal.title,text:signal.copy,artifact:signal.artifact,artifactVersion:signal.version||signal.revision,signalId:signal.id,revision:signal.revision});signal.messageId=message.id;
  }else if(event==='withdrawn'){
    if(signal.state!=='active')return {ok:false,reason:'This signal has already been answered.'};
    signal.state='withdrawn';signal.reason='The agent no longer needs this decision.';
    append(state,conversation,{author:'system',text:signal.reason});
  }else if(event==='answered'){
    if(signal.state!=='active')return {ok:false,reason:'This signal already has a response.'};
    signal.state='answered';signal.answer='Answered on your iPhone.';signal.answeredElsewhere=true;
    const message=append(state,conversation,{author:'you',text:signal.kind==='review'?'Use the quieter Type direction.':'Go with the first option.',delivery:'received',origin:'iPhone'});
    signal.responseId=message.id;
  }else if(event==='failed'){
    const last=conversation.messages.filter(message=>message.author==='you').at(-1);
    if(!last||last.order===conversation.messages[0].order)return {ok:false,reason:'Send a reply first to preview a delivery problem.'};
    last.delivery='failed';last.failure='The agent session is no longer available. Start a new message to continue.';
  }else if(event==='expired'){
    if(signal.state!=='active')return {ok:false,reason:'This signal already has a response.'};
    signal.state='expired';signal.reason='This decision window has ended.';
    append(state,conversation,{author:'system',text:signal.reason});
  }
  return {ok:true,signal,conversation};
}
export function addApproval(state) {
  if(state.signals.approval)return state.signals.approval;
  const conversation=state.conversations.launch;
  const previous=latestSignal(state,conversation);
  if(previous?.requiresResponse&&previous.state==='active'){previous.state='withdrawn';previous.reason='Replaced by the staging approval.';append(state,conversation,{author:'system',text:previous.reason});}
  return publish(state,conversation,{id:'approval',kind:'approval',requiresResponse:true,title:'Put it on staging?',copy:'Volt is ready for a closer look. I can publish this version to your staging preview.',artifact:'launch',scope:'One staging deployment of Volt. No production publish.',terms:'Somae launch · Volt · staging only'});
}
