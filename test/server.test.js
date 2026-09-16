'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const WebSocket=require('ws');
const {randomUUID}=require('crypto');
const {createApp}=require('../server');
async function client(port){
 const ws=new WebSocket('ws://127.0.0.1:'+port+'/socket.io/?EIO=4&transport=websocket');
 const pending=new Map();let count=0;let latest;
 await new Promise((resolve,reject)=>{
  ws.on('error',reject);
  ws.on('message',data=>{
   const msg=data.toString();
   if(msg.startsWith('0'))ws.send('40');
   else if(msg==='2')ws.send('3');
   else if(msg.startsWith('40'))resolve();
   else if(msg.startsWith('43')){
    const match=msg.match(/^43(\d+)(.*)$/);
    if(match&&pending.has(match[1])){pending.get(match[1])(JSON.parse(match[2])[0]);pending.delete(match[1]);}
   }else if(msg.startsWith('42')){const [event,state]=JSON.parse(msg.slice(2));if(event==='state')latest=state;}
  });
 });
 return {ws,get latest(){return latest;},waitState(predicate){
  if(latest&&predicate(latest))return Promise.resolve(latest);
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{ws.off('message',check);reject(new Error('state timeout'));},3000);
   function check(){if(latest&&predicate(latest)){clearTimeout(timer);ws.off('message',check);resolve(latest);}}
   ws.on('message',check);
  });
 },call(event,data){
  return new Promise((resolve,reject)=>{
   const id=String(++count),timer=setTimeout(()=>reject(new Error('ack timeout: '+event)),3000);
   pending.set(id,result=>{clearTimeout(timer);resolve(result);});
   ws.send('42'+id+JSON.stringify([event,data]));
  });
 }};
}
test('online rooms synchronize, validate turns, reconnect and isolate spectators',async()=>{
 const {server,io}=createApp();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port,clients=[];
 try {
  const a=await client(port),b=await client(port);clients.push(a,b);
  const session=randomUUID();
  const ja=await a.call('join-room',{roomId:'test',name:'A',sessionId:session});
  const jb=await b.call('join-room',{roomId:'test',name:'B',sessionId:randomUUID()});
  assert.equal(ja.player,0);assert.equal(jb.player,1);

  assert.equal(jb.state.game,null);
  assert.equal((await b.call('action',{type:'configure',firstPlayer:1,firstTurnPenalty:true})).ok,false);
  assert.equal((await a.call('action',{type:'configure',firstPlayer:1,firstTurnPenalty:true})).ok,true);
  assert.equal(a.latest.game,null);assert.equal(a.latest.settings.firstPlayer,1);
  assert.equal((await a.call('action',{type:'roll'})).ok,false);
  assert.equal((await a.call('action',{type:'configure',firstPlayer:0,firstTurnPenalty:true})).ok,true);
  assert.equal((await b.call('action',{type:'roll'})).ok,false);
  assert.equal((await a.call('action',{type:'roll'})).ok,true);
  await b.waitState(s=>s.game?.phase==='choose');assert.deepEqual(a.latest.game.dice,b.latest.game.dice);
  assert.equal(a.latest.game.phase,'choose');
  assert.equal(JSON.stringify(a.latest).includes(session),false);

  assert.equal((await a.call('action',{type:'configure',firstPlayer:1,firstTurnPenalty:false})).ok,false);
  const columns=a.latest.game.options[0].advances;
  assert.equal((await a.call('action',{type:'confirm-climb',columns,rollId:-1})).ok,false);
  assert.equal((await a.call('action',{type:'confirm-climb',columns:[13],rollId:a.latest.game.rollId})).ok,false);
  assert.equal((await a.call('action',{type:'bank'})).ok,false);
  assert.equal((await a.call('action',{type:'confirm-climb',columns,rollId:a.latest.game.rollId})).ok,true);
  const o={runners:{...a.latest.game.runners}};
  assert.ok(Object.keys(o.runners).length<=2);
  assert.equal((await a.call('action',{type:'bank'})).ok,true);assert.equal(a.latest.game.turn,1);
  const spectator=await client(port);clients.push(spectator);
  const js=await spectator.call('join-room',{roomId:'test',name:'Guest',sessionId:randomUUID()});
  assert.equal(js.player,-1);assert.equal((await spectator.call('action',{type:'roll'})).ok,false);
  a.ws.close();await new Promise(resolve=>a.ws.once('close',resolve));
  const reconnect=await client(port);clients.push(reconnect);
  const jr=await reconnect.call('join-room',{roomId:'test',name:'A',sessionId:session});
  assert.equal(jr.player,0);assert.equal(jr.state.game.turn,1);
  assert.deepEqual(jr.state.game.players[0].progress,o.runners);
  assert.equal((await reconnect.call('action',{type:'restart'})).ok,true);
  assert.equal(reconnect.latest.game.turn,1);
  assert.equal((await b.call('action',{type:'restart'})).ok,true);
  assert.equal(b.latest.game.turn,0);assert.equal(b.latest.game.phase,'setup');assert.deepEqual(b.latest.game.players[0].progress,{});

  assert.equal((await b.call('send-chat','hello')).ok,true);
  assert.equal(b.latest.chat[0].name,'B');assert.equal(b.latest.chat[0].senderId,'player-1');assert.ok(b.latest.chat[0].time>0);
  const local=await spectator.call('join-room',{roomId:'local-test',name:'Local',sessionId:randomUUID(),mode:'local',count:4});

  assert.equal(local.state.game.players.length,4);assert.equal(local.state.game.phase,'setup');
  assert.equal((await spectator.call('action',{type:'configure',firstPlayer:3,firstTurnPenalty:true})).ok,true);
  assert.equal(spectator.latest.game.turn,3);assert.equal(spectator.latest.game.phase,'setup');
  assert.equal((await spectator.call('action',{type:'roll'})).ok,true);
  assert.equal(spectator.latest.game.turn,3);assert.equal(spectator.latest.game.firstTurnPenalty,true);
  const denial=await b.call('join-room',{roomId:'local-test',name:'Intruder',sessionId:randomUUID(),mode:'local'});
  assert.equal(denial.ok,false);
 } finally {clients.forEach(c=>c.ws.terminate());await new Promise(resolve=>io.close(resolve));}
});


