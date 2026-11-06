import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, attention, startMessage, submitResponse, saveDraft, simulateSignalState, simulateReply, setOnline, endpointAvailability, signalQueue, clearResult } from './conversation-model.js';
const desktop={id:'macbook',kind:'desktop'},phone={id:'iphone',kind:'mobile'};

test('unread answers are distinct from required responses; new messages create no pending decision',()=>{
 const state=createState();assert.equal(attention(state).needs.length,2);assert.equal(attention(state).fresh.length,2);
 const sent=startMessage(state,{endpointId:'orbit-hosted',text:'A new idea',device:phone});assert.equal(sent.ok,true);
 assert.equal(attention(state).needs.length,2);assert.equal(attention(state).fresh.length,2);
 const reply=simulateReply(state,sent.conversation.id);assert.equal(reply.ok,true);assert.equal(attention(state).fresh.length,3);
});
test('mobile can queue a bounded reply to local session but cannot initiate local work',()=>{
 const state=createState();setOnline(state,'codex-macbook',false);
 assert.equal(endpointAvailability(state,'codex-macbook',phone).allowed,false);
 assert.equal(startMessage(state,{endpointId:'codex-macbook',text:'Start elsewhere',device:phone}).ok,false);
 const sent=submitResponse(state,'local-layout',{text:'Tighten it a little',revision:1,device:phone});assert.equal(sent.ok,true);assert.equal(sent.message.delivery,'queued');
 assert.equal(simulateReply(state,'local-layout').ok,false);
 setOnline(state,'codex-macbook',true);assert.equal(sent.message.delivery,'received');
 assert.equal(simulateReply(state,'local-layout').ok,true);
});
test('changed terms invalidate a draft without losing it or accepting a response',()=>{
 const state=createState();saveDraft(state,state.signals.launch,'Keep this feedback','feedback');
 simulateSignalState(state,'launch','updated');
 const reply=submitResponse(state,'launch',{text:'Keep this feedback',revision:1,device:desktop});
 assert.equal(reply.code,'stale');assert.equal(state.drafts.launch.text,'Keep this feedback');assert.equal(state.signals.launch.state,'active');
});
test('withdrawn requests and a second device answer cannot be silently submitted as a follow-up',()=>{
 for(const event of ['withdrawn','answered','expired']){
  const state=createState();saveDraft(state,state.signals.launch,'My draft');simulateSignalState(state,'launch',event);
  const before=state.conversations.launch.messages.length;
  assert.equal(submitResponse(state,'launch',{text:'My draft',revision:1,device:desktop}).ok,false);
  assert.equal(state.conversations.launch.messages.length,before);assert.equal(state.drafts.launch.text,'My draft');
 }
});
test('a question to an approval does not approve or close it',()=>{
 const state=createState();
 const result=submitResponse(state,'launch',{text:'Can you show another version?',revision:1,device:phone,mode:'ask'});
 assert.equal(result.ok,true);assert.equal(state.signals.launch.state,'active');assert.equal(result.message.terminal,false);
 assert.equal(simulateReply(state,'launch').ok,true);assert.equal(state.signals.launch.state,'active');
 assert.ok(attention(state).needs.some(signal=>signal.id==='launch'));
});
test('a submitted reply stays in its conversation and a later result continues that timeline once',()=>{
 const state=createState();const reply=submitResponse(state,'trip',{text:'Make it slower',revision:1,device:phone});assert.equal(reply.ok,true);
 assert.equal(state.conversations.trip.messages.length,3);
 const answer=simulateReply(state,'trip');assert.equal(answer.ok,true);assert.equal(answer.signal.conversationId,'trip');assert.equal(state.conversations.trip.messages.length,4);
 assert.equal(simulateReply(state,'trip').ok,false);
});
test('shared context is a snapshot and paused/disconnected destinations reject input',()=>{
 const state=createState();state.context='Original brief';
 const sent=startMessage(state,{endpointId:'orbit-hosted',text:'Explore this',includeContext:true,device:phone});
 state.context='Changed brief';assert.equal(sent.message.contextSnapshot,'Original brief');
 state.paused.push('orbit-hosted');assert.equal(submitResponse(state,'trip',{text:'Hello',revision:1,device:phone}).ok,false);
 state.connected=state.connected.filter(id=>id!=='claude-hosted');assert.equal(submitResponse(state,'launch',{text:'Hello',revision:1,device:phone}).ok,false);
});

test('the signal queue keeps a viewed result until Done or Reply and clears without ending its conversation',()=>{
 const state=createState();assert.deepEqual(signalQueue(state).map(signal=>signal.id),['launch','local-layout','trip','focus']);
 state.signals['local-layout'].unread=false;assert.equal(signalQueue(state).length,4);
 assert.equal(clearResult(state,'launch'),false);
 assert.equal(clearResult(state,'local-layout'),true);assert.equal(state.signals['local-layout'].state,'active');
 assert.equal(state.conversations['local-layout'].messages.length,2);
 assert.equal(submitResponse(state,'launch',{text:'Use Volt',revision:1,device:desktop,decision:true}).ok,true);
 assert.equal(clearResult(state,'trip'),true);
 assert.equal(submitResponse(state,'focus',{text:'Two hours of focus',revision:1,device:phone,decision:true}).ok,true);
 assert.equal(signalQueue(state).length,0);
});
