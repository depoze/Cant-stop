'use strict';
// Express/static hosting, Socket.IO room broadcasts, and reconnect sessions
// are adapted from ../twixt-multiplayer/server.js.
const express=require('express');
const http=require('http');
const {Server}=require('socket.io');
const path=require('path');
const {randomInt}=require('crypto');
const G=require('./game');
function createApp() {
  const app=express(), server=http.createServer(app);
  const io=new Server(server,{transports:['websocket'],pingInterval:25000,pingTimeout:40000});
  app.use((req,res,next)=>{
    if (/\.(js|css|html)$/.test(req.path) || req.path==='/') res.setHeader('Cache-Control','no-store');
    next();
  });
  app.use(express.static(path.join(__dirname,'public')));
  app.get('/health',(_,res)=>res.json({ok:true,game:'cant-stop'}));
  const rooms=new Map();
  const text=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
  function state(r) {
    return {roomId:r.id,mode:r.mode,host:r.host,players:r.players.map(p=>({name:p.name,connected:!!p.socketId,color:p.color})),
      settings:r.settings,game:r.game,chat:r.chat,heights:G.HEIGHTS,restartVotes:[...r.votes]};
  }
  function emit(r) {r.touched=Date.now();io.to(r.id).emit('state',state(r));}
  function detach(socket) {
    const r=rooms.get(socket.data.roomId);
    if(!r) return;
    const p=r.players.find(p=>p.socketId===socket.id);
    if(p) p.socketId=null;
    socket.leave(r.id); socket.data.roomId=null; emit(r);
  }
  io.on('connection',socket=>{
    socket.on('join-room',(data={},ack=()=>{})=>{
      try {
        if(!data || typeof data!=='object') throw new Error('잘못된 참가 요청입니다.');
        const id=text(data.roomId,24),sessionId=text(data.sessionId,100);
        if(!/^[a-zA-Z0-9가-힣_-]{1,24}$/.test(id)) throw new Error('방 코드는 한글, 영문, 숫자, -와 _만 사용할 수 있습니다.');
        if(sessionId.length<16) throw new Error('새로고침 후 다시 참가해 주세요.');
        const name=text(data.name,18)||'플레이어';
        const mode=data.mode==='local'?'local':'online';
        let r=rooms.get(id);
        if(r && r.mode!==mode) throw new Error('다른 방식으로 사용 중인 방 코드입니다.');
        if(r?.mode==='local' && r.owner!==sessionId) throw new Error('이 방은 한 화면에서 플레이하는 방입니다.');
        detach(socket);
        if(!r) {
          r={id,mode,owner:sessionId,host:0,players:[],game:null,settings:{firstPlayer:0,firstTurnPenalty:false},chat:[],votes:new Set(),touched:Date.now()};
          rooms.set(id,r);
        }
        let index=r.players.findIndex(p=>p.sessionId===sessionId);
        if(index===-1 && (!r.game || r.game.phase==='setup') && r.players.length<4) {
          index=r.players.length;
          r.players.push({name,sessionId,socketId:socket.id,color:G.COLORS[index]});
        } else if(index!==-1) {
          const oldSocket=io.sockets.sockets.get(r.players[index].socketId);
          if(oldSocket && oldSocket.id!==socket.id) {
            oldSocket.emit('session-replaced');oldSocket.leave(id);oldSocket.data.roomId=null;
          }
          r.players[index].socketId=socket.id;
        }
        if(mode==='online' && r.game?.phase==='setup') r.game=G.createGame(r.players.map(p=>p.name),r.settings);
        socket.data.roomId=id; socket.data.player=index;
        socket.join(id);
        if(mode==='local' && !r.game) {
          const count=Math.max(2,Math.min(4,Number(data.count)||2));
          r.game=G.createGame(Array.from({length:count},(_,i)=>i===0?name:'플레이어 '+(i+1)),r.settings);
        }
        ack({ok:true,player:index,state:state(r)});
        emit(r);
      } catch(e) {ack({ok:false,error:e.message});}
    });
    socket.on('action',(data={},ack=()=>{})=>{
      try {
        const r=rooms.get(socket.data.roomId),index=socket.data.player;
        if(!r || index<0 || r.players[index]?.socketId!==socket.id) throw new Error('플레이어만 조작할 수 있습니다.');
        if(!data || typeof data!=='object') throw new Error('잘못된 요청입니다.');
        if(data.type==='configure') {
          if(index!==r.host || (r.game && r.game.phase!=='setup')) throw new Error('게임 시작 전에 방장만 설정할 수 있습니다.');
          const count=r.mode==='local'?r.game.players.length:r.players.length;
          const first=data.randomFirst?randomInt(count):data.firstPlayer;
          if(!Number.isInteger(first)||first<0||first>=count||typeof data.firstTurnPenalty!=='boolean') throw new Error('시작 설정을 확인해 주세요.');
          r.settings={firstPlayer:first,firstTurnPenalty:data.firstTurnPenalty};
          if(r.game)r.game=G.createGame(r.game.players.map(p=>p.name),r.settings);
        } else if(data.type==='restart') {
          if(!r.game) throw new Error('게임을 먼저 시작해 주세요.');
          r.votes.add(index);
          if(r.mode==='local' || r.players.every((_,i)=>r.votes.has(i))) {
            r.game=G.createGame(r.game.players.map(p=>p.name),r.settings);r.votes.clear();
          }
        } else {
          if(!r.game || r.game.phase==='setup') {
            if(data.type!=='roll')throw new Error('주사위를 굴려 게임을 시작해 주세요.');
            if(r.mode==='online' && (r.players.length<2||r.players.some(p=>!p.socketId)))throw new Error('연결된 플레이어가 2명 이상 필요합니다.');
            if(r.mode==='online' && index!==r.settings.firstPlayer)throw new Error('선공 플레이어가 먼저 굴려야 합니다.');
            if(!r.game)r.game=G.createGame(r.players.map(p=>p.name),r.settings);
          }
          if(r.mode==='online' && r.game.turn!==index) throw new Error('다른 플레이어의 차례입니다.');
          if(data.type==='roll') G.roll(r.game,()=>randomInt(1,7));
          else if(data.type==='confirm-climb') G.confirmClimb(r.game,data.columns,data.rollId);
          else if(data.type==='choose-pair') G.choosePair(r.game,data.indices,data.rollId);
          else if(data.type==='bank') G.bank(r.game);
          else if(data.type==='next') G.continueAfterBust(r.game);
          else throw new Error('알 수 없는 동작입니다.');
        }
        emit(r);ack({ok:true});
      } catch(e) {ack({ok:false,error:e.message});}
    });
    socket.on('send-chat',(value,ack=()=>{})=>{
      const r=rooms.get(socket.data.roomId),message=text(value,240);
      if(!r || !message) return ack({ok:false});
      const now=Date.now();
      if(now-(socket.data.lastChat||0)<500) return ack({ok:false});
      socket.data.lastChat=now;
      const chatPlayer=r.mode==='local'?r.game.players[r.game.turn]:r.players[socket.data.player];
      r.chat.push({senderId:r.mode==='local'?'local-'+r.game.turn:socket.data.player>=0?'player-'+socket.data.player:'guest-'+socket.id,
        name:chatPlayer?.name||'관전자',color:chatPlayer?.color||'#65718a',time:now,text:message});
      r.chat=r.chat.slice(-60);emit(r);ack({ok:true});
    });
    socket.on('leave-room',()=>detach(socket));
    socket.on('disconnect',()=>detach(socket));
  });
  const cleanup=setInterval(()=>{
    for(const [id,r] of rooms) if(!r.players.some(p=>p.socketId)&&Date.now()-r.touched>2*60*60*1000) rooms.delete(id);
  },60000);
  cleanup.unref();server.on('close',()=>clearInterval(cleanup));
  return {app,server,io,rooms};
}
if(require.main===module) {
  const {server}=createApp(),port=Number(process.env.PORT)||3000;
  server.listen(port,()=>console.log("Can't Stop: http://localhost:"+port));
}
module.exports={createApp};

