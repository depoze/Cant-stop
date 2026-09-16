'use strict';
// Socket connection/reconnection settings follow the existing Twixt client.
const socket=io({transports:['websocket'],upgrade:false,reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:500,reconnectionDelayMax:5000,randomizationFactor:.5});
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let sessionId=sessionStorage.getItem('cantStopSessionId')||crypto.randomUUID();
sessionStorage.setItem('cantStopSessionId',sessionId);
let room=null,player=-1,joined=false,joinData=null,planned=[],lastGame=null,busy=false,toastTimer,lastChat='',presentation=null,presentationTimer=null;

let panelsCollapsed=localStorage.getItem('cantStopPanelsCollapsed')==='true';
function beforeStart(){return !room?.game||room.game.phase==='setup';}
function allPlayers(){return room.game?.players||room.players;}
function runnerLimit(){return room?.settings.firstTurnPenalty&&(room.game?.turnNumber||1)===1?2:3;}

function selectedOption(){
 const g=room?.game;if(!g||g.phase!=='choose'||!planned.length)return null;
 const key=[...planned].sort((a,b)=>a-b).join(',');
 return g.options.find(o=>[...o.advances].sort((a,b)=>a-b).join(',')===key)||null;
}
function animationFrame(){
 const now=performance.now(),bust=room?.game?.phase==='bust';
 let elapsed=presentation?now-presentation.startedAt:Infinity;
 if(bust&&presentation?.revealedAt!==undefined)elapsed=RollPresentation.REVEAL_AT[3]+now-presentation.revealedAt;
 return RollPresentation.frame(elapsed,bust);
}
function visibleGame(){return RollPresentation.visibleGame(room?.game,animationFrame());}
function stopPresentation(){
 clearInterval(presentationTimer);presentationTimer=null;presentation=null;
 document.getElementById('fallLayer')?.remove();
}
function startFall(){
 if(!presentation||presentation.fallStarted)return;
 presentation.fallStarted=true;
 planned=[];
 const layer=document.createElement('div');layer.id='fallLayer';layer.setAttribute('aria-hidden','true');
 document.querySelectorAll('#dice .die,#board .runner').forEach((source,i)=>{
   const rect=source.getBoundingClientRect(),clone=source.cloneNode(true);
   clone.removeAttribute('id');clone.classList.remove('is-rolling');
   clone.classList.add('falling-token');
   Object.assign(clone.style,{position:'fixed',left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px',margin:'0',transform:'none'});
   clone.style.setProperty('--drift',((i%2?1:-1)*(30+(i*17)%70))+'px');
   clone.style.setProperty('--tumble',(i%2?160:-140)+'deg');
   layer.append(clone);
 });
 document.body.append(layer);
}
function syncPresentation(){
 const g=room?.game;
 if(!g?.dice.length){if(presentation)stopPresentation();return;}
 const key=room.roomId+':'+g.turnNumber+':'+g.rollId;
 if(presentation?.key!==key){
   stopPresentation();presentation={key,startedAt:performance.now(),fallStarted:false};
   presentationTimer=setInterval(()=>{
     if(!room){stopPresentation();return;}
     render();
     const f=animationFrame();
     if(!f.rolling&&(room.game.phase!=='bust'||f.fallen)){clearInterval(presentationTimer);presentationTimer=null;}
   },55);
 }
 if(!animationFrame().rolling&&presentation.revealedAt===undefined)presentation.revealedAt=performance.now();
 if(animationFrame().falling)startFall();
 if(animationFrame().fallen)document.getElementById('fallLayer')?.remove();
}
function applyPanelState(){
 $('gameScreen').classList.toggle('panels-collapsed',panelsCollapsed);
 $('panelToggleBtn').textContent=panelsCollapsed?'패널 펼치기 ›':'패널 접기 ‹';
 $('panelToggleBtn').setAttribute('aria-expanded',String(!panelsCollapsed));
}
$('panelToggleBtn').onclick=()=>{panelsCollapsed=!panelsCollapsed;localStorage.setItem('cantStopPanelsCollapsed',panelsCollapsed);applyPanelState();};
function configure(randomFirst=false){action('configure',{firstPlayer:Number($('firstPlayer').value),firstTurnPenalty:$('firstTurnPenalty').checked,randomFirst});}
$('firstPlayer').onchange=()=>configure();
$('firstTurnPenalty').onchange=()=>configure();
$('randomFirstBtn').onclick=()=>configure(true);

const pips={1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
const savedName=localStorage.getItem('cantStopName');if(savedName)$('nameInput').value=savedName;
const requestedRoom=new URLSearchParams(location.search).get('room');if(requestedRoom)$('roomInput').value=requestedRoom;
document.querySelector('.mini-mountain').innerHTML=[3,5,7,9,11,13,11,9,7,5,3].map(h=>'<i style="height:'+h*17+'px"></i>').join('');
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
function controlsEnabled(){return !!(socket.connected&&room&&(room.mode==='local'||player===(room.game?.turn??room.settings.firstPlayer))&&player>=0);}
function isChoosing(){return controlsEnabled()&&visibleGame()?.phase==='choose'&&!busy&&!animationFrame().rolling;}
function connected(){
  $('connection').textContent=socket.connected?'서버 연결됨':'연결 복구 중';
  $('connection').classList.toggle('offline',!socket.connected);
}
function join(mode='online',reconnecting=false) {
  if(!socket.connected){$('joinError').textContent='서버에 연결 중입니다. 잠시 후 다시 시도해 주세요.';return;}
  if(!reconnecting)joinData={roomId:mode==='local'?'local-'+crypto.randomUUID().slice(0,12):$('roomInput').value.trim(),name:$('nameInput').value.trim()||'플레이어 1',sessionId,mode,count:Number($('localCount').value)};
  $('joinError').textContent='';$('localBtn').disabled=true;$('joinForm').querySelector('button').disabled=true;
  socket.timeout(5000).emit('join-room',joinData,(error,result)=>{
    $('localBtn').disabled=false;$('joinForm').querySelector('button').disabled=false;
    if(error||!result?.ok){const message=result?.error||'연결되지 않았습니다. 다시 시도해 주세요.';$('joinError').textContent=message;toast(message);return;}
    player=result.player;joined=true;room=result.state;
    localStorage.setItem('cantStopName',joinData.name);
    $('joinScreen').hidden=true;$('gameScreen').hidden=false;
    history.replaceState(null,'',mode==='online'?'?room='+encodeURIComponent(room.roomId):location.pathname);
    render();
  });
}
$('joinForm').addEventListener('submit',event=>{event.preventDefault();join();});
$('localBtn').onclick=()=>join('local');
socket.on('connect',()=>{connected();if(joined&&joinData)join(joinData.mode,true);});
socket.on('disconnect',()=>{connected();busy=false;if(room)render();});
socket.on('state',state=>{if(joined){room=state;render();}});
socket.on('session-replaced',()=>{stopPresentation();joined=false;joinData=null;room=null;$('joinScreen').hidden=false;$('gameScreen').hidden=true;$('joinError').textContent='다른 탭에서 이 세션에 접속했습니다. 새로 참가하려면 페이지를 새로고침하세요.';sessionId=crypto.randomUUID();sessionStorage.setItem('cantStopSessionId',sessionId);});
function action(type,extra={}) {
  if(busy||!socket.connected)return;
  busy=true;renderActions();
  socket.timeout(5000).emit('action',{type,...extra},(error,result)=>{
    busy=false;if(error||!result?.ok)toast(result?.error||'요청을 확인하지 못했습니다. 현재 상태를 확인해 주세요.');
    if(room)render();
  });
}

$('rollBtn').onclick=()=>{
 if(visibleGame()?.phase==='choose'){
   if(selectedOption()&&isChoosing())action('confirm-climb',{columns:[...planned],rollId:room.game.rollId});
 }else{planned=[];action('roll');}
};
$('clearSelectionBtn').onclick=()=>{planned=[];renderBoard();renderDice();renderActions();};

$('bankBtn').onclick=()=>action('bank');
$('nextBtn').onclick=()=>action('next');

$('restartBtn').onclick=()=>{if(confirm(room.mode==='local'?'진행을 지우고 새 게임을 시작할까요?':'모두 동의하면 진행을 지우고 새 게임을 시작합니다. 동의할까요?'))action('restart');};
$('leaveBtn').onclick=()=>{
  if(room?.game&&!['setup','ended'].includes(room.game.phase)&&!confirm('방을 나갈까요? 온라인 게임은 같은 방 코드로 다시 참가할 수 있습니다.'))return;
  stopPresentation();socket.emit('leave-room');joined=false;joinData=null;room=null;planned=[];lastGame=null;
  $('joinScreen').hidden=false;$('gameScreen').hidden=true;history.replaceState(null,'',location.pathname);
};
$('copyBtn').onclick=async()=>{
  const url=location.origin+'/?room='+encodeURIComponent(room.roomId);
  try{await navigator.clipboard.writeText(url);toast('초대 링크를 복사했습니다.');}catch{toast('방 코드: '+room.roomId);}
};
$('rulesBtn').onclick=()=>$('rulesDialog').showModal();
$('closeRules').onclick=()=>$('rulesDialog').close();
$('rulesDialog').onclick=e=>{if(e.target===$('rulesDialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}};
$('chatForm').onsubmit=e=>{e.preventDefault();const text=$('chatInput').value.trim();if(text&&socket.connected)socket.emit('send-chat',text,result=>{if(result?.ok)$('chatInput').value='';});};

function render() {
  if(!room)return;
  syncPresentation();
  const g=visibleGame();
  const frame=animationFrame();
  const signature=g?g.turnNumber+':'+g.rollId+':'+g.phase+':'+g.moves+':'+g.turn:'lobby';
  if(signature!==lastGame){planned=[];lastGame=signature;}
  connected();applyPanelState();$('gameScreen').classList.toggle('is-setup',beforeStart());
  $('roomTitle').textContent=room.mode==='local'?'우리들의 테이블':room.roomId;
  $('copyBtn').hidden=room.mode==='local';
  $('myRole').textContent=room.mode==='local'?g.players.length+'명 · 한 화면 플레이':player<0?'관전 중 · 게임을 함께 지켜보세요':(player===room.host?'방장':'플레이어')+' · '+room.players.length+'/4명 참가';
  const players=g?g.players:room.players;
  $('players').innerHTML=players.map((p,i)=>{
    const count=g?Object.values(g.claimed).filter(v=>v===i).length:0;
    const offline=room.mode==='online'&&!room.players[i]?.connected;
    return '<div class="player '+((g?.turn??room.settings.firstPlayer)===i?'active':'')+'" style="--player:'+p.color+'"><i class="player-dot"></i><span class="player-name">'+esc(p.name)+'<span class="player-tag">'+(offline?'연결 끊김':room.mode==='online'&&i===player?'나':'')+'</span></span><span class="score"><b>'+count+'</b> / 3</span></div>';
  }).join('');
  $('turnNumber').textContent=beforeStart()?'준비 중':'TURN '+String(g.turnNumber).padStart(2,'0');
  $('turnTitle').textContent=beforeStart()?'게임 시작 전':g.phase==='ended'?'정상에 도착했습니다!':g.phase==='bust'&&!frame.rolling?'등반 실패':g.players[g.turn].name+' 님의 차례';
  $('statusText').textContent=beforeStart()?'선후공과 패널티를 정하세요. 선공 플레이어가 처음 굴리면 게임이 시작됩니다.':frame.rolling?'주사위를 굴리고 있습니다.':g.message;
  if(g&&room.mode==='online'&&!room.players[g.turn]?.connected&&g.phase!=='ended')$('statusText').textContent='현재 플레이어의 재접속을 기다리고 있습니다.';
  const count=Object.keys(g?.runners||{}).length,limit=runnerLimit();
  $('runnerSupply').innerHTML=Array.from({length:limit},(_,i)=>i).map(i=>'<i class="supply '+(i<count?'used':'')+'" title="'+(i<count?'보드에서 사용 중':'사용 가능')+'"></i>').join('');
  $('climbSummary').textContent=count?Object.entries(g.runners).map(([c,p])=>c+'번 +'+(p-(g.players[g.turn].progress[c]||0))).join('  ·  '):'최대 '+limit+'개의 열'+(limit===2?' · 선공 첫 턴 패널티':'을 오를 수 있어요');
  $('activity').innerHTML=g?.log.length?g.log.slice(0,8).map(l=>'<p><small>T'+l.turn+'</small>'+esc(l.text)+'</p>').join(''):'<p class="muted">첫 등반을 기다리고 있어요.</p>';

  const chatKey=JSON.stringify(room.chat);
  if(chatKey!==lastChat){
    const box=$('chatMessages'),nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<65;
    const groups=[];
    for(const message of room.chat){
      const previous=groups[groups.length-1];
      if(previous&&previous.senderId===message.senderId){previous.messages.push(message);previous.time=message.time;}
      else groups.push({...message,messages:[message]});
    }
    box.innerHTML=groups.length?groups.map(group=>{
      const time=new Date(group.time).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false});
      return '<div class="chat-group"><div class="chat-author" style="color:'+group.color+'">'+esc(group.name)+'<time> · '+time+'</time></div>'+group.messages.map(m=>'<p>'+esc(m.text)+'</p>').join('')+'</div>';
    }).join(''):'<p class="chat-empty">테이블에 모인 사람들과<br>이야기를 나눠 보세요.</p>';
    if(nearBottom||!lastChat)box.scrollTop=box.scrollHeight;
    lastChat=chatKey;
  }
  $('chatCount').textContent=room.chat.length+'개의 메시지';
  const names=allPlayers(),settings=room.settings;
  $('setupPanel').hidden=!beforeStart();
  $('firstPlayer').innerHTML=names.map((p,i)=>'<option value="'+i+'">'+esc(p.name)+'</option>').join('');
  $('firstPlayer').value=settings.firstPlayer;
  $('firstTurnPenalty').checked=settings.firstTurnPenalty;
  $('turnOrder').textContent='순서: '+names.map((_,i)=>names[(settings.firstPlayer+i)%names.length].name).join(' → ');
  renderBoard();renderDice();renderActions();
}

function renderActions(){
 const g=visibleGame(),mine=controlsEnabled(),phase=g?.phase||'setup',frame=animationFrame(),choosing=phase==='choose';
 $('rollBtn').disabled=!mine||busy||frame.rolling||(choosing?!selectedOption():!['setup','roll','decide'].includes(phase))||
   (beforeStart()&&room.mode==='online'&&(room.players.length<2||room.players.some(p=>!p.connected)));
 $('rollBtn').innerHTML=frame.rolling?'굴리는 중… <span>↻</span>':choosing?'등반 확인 <span>✓</span>':phase==='setup'?'굴리고 게임 시작 <span>⚄</span>':phase==='decide'?'한 번 더 굴리기 <span>↻</span>':'주사위 굴리기 <span>⚄</span>';
 for(const id of ['firstPlayer','firstTurnPenalty','randomFirstBtn'])$(id).disabled=busy||!socket.connected||player!==room.host||!beforeStart();
 $('bankBtn').disabled=!mine||busy||frame.rolling||phase!=='decide';
 $('nextBtn').hidden=phase!=='bust'||frame.rolling;
 $('nextBtn').disabled=!mine||busy||!frame.fallen;
 document.querySelector('.action-buttons').hidden=(phase==='bust'&&!frame.rolling)||phase==='ended';
 $('winnerPanel').hidden=phase!=='ended';
 if(phase==='ended')$('winnerPanel').textContent='⚑ '+g.players[g.winner].name+' 님이 승리했습니다!';
 $('restartBtn').disabled=!g||player<0||busy||!socket.connected||frame.rolling||room.restartVotes.includes(player);
 $('restartBtn').textContent=room?.restartVotes.length?'↻ 다시 시작 동의 '+room.restartVotes.length+'/'+room.players.length:'↻ 다시 시작 요청';
}

function renderBoard(){
 const g=visibleGame(),frame=animationFrame(),option=selectedOption();
 const runners=g?.phase==='bust'?(frame.falling||frame.fallen?{}:g.bustRunners||{}):g?.runners||{};
 const preview={...runners};
 for(const col of planned)preview[col]=(preview[col]??g?.players[g.turn].progress[col]??0)+1;
 $('board').innerHTML=Object.entries(room.heights).map(([c,height])=>{
   const col=Number(c),owner=g?.claimed[c],closed=owner!==undefined,count=planned.filter(n=>n===col).length;
   const spaces=Array.from({length:height},(_,i)=>{
     const pos=i+1,markers=(g?.players||[]).map((p,i)=>({p,i})).filter(({p})=>p.progress[c]===pos);
     const markersHTML=markers.map(({p},n)=>'<i class="piece" style="--player:'+p.color+';--offset:'+((n-(markers.length-1)/2)*6)+'px" title="'+esc(p.name)+' · '+pos+'칸"></i>').join('');
     const runner=runners[c]===pos?'<i class="runner" title="이번 턴 · 아직 저장하지 않음"></i>':'';
     const ghost=count&&pos>(runners[c]??g?.players[g.turn].progress[c]??0)&&pos<=preview[c];
     return '<div class="space '+(ghost?'preview '+(option?'':'invalid-preview'):'')+'">'+markersHTML+runner+'</div>';
   }).join('');
   return '<div class="column '+(count?'chosen '+(option?'valid-selection':'invalid-selection')+' ':'')+(closed?'closed':'')+'" data-column="'+col+'" '+(closed?'style="--owner:'+g.players[owner].color+'"':'')+'><span class="summit">'+(count?'+'+count:closed?'⚑':'⌃')+'</span><div class="spaces">'+spaces+'</div><button class="column-number" data-column="'+col+'" aria-label="'+col+'번 열'+(count?' · '+count+'칸 선택':'')+'" aria-pressed="'+!!count+'">'+col+'</button></div>';
 }).join('');
}
function dieHTML(value,index,frame){
 const rolling=index>=frame.revealed&&frame.rolling;
 const elapsed=presentation?performance.now()-presentation.startedAt:0;
 const face=rolling?1+((Math.floor(elapsed/70)+index*2)%6):value;
 const spin=rolling?'transform:translateY('+Math.sin(elapsed/70+index)*5+'px) rotate('+(elapsed*1.7+index*45)%360+'deg)':'';
 return '<div class="die '+(!face?'dim ':'')+(rolling?'is-rolling':'revealed')+'" role="img" aria-label="주사위 '+(index+1)+': '+(rolling?'굴리는 중':face||'굴리기 전')+'" style="'+spin+'">'+Array.from({length:9},(_,i)=>'<i class="'+(face&&pips[face].includes(i)?'pip':'')+'"></i>').join('')+'</div>';
}
function renderDice(){
 const g=visibleGame(),phase=g?.phase,frame=animationFrame();
 $('dice').classList.toggle('bust-cleared',phase==='bust'&&(frame.falling||frame.fallen));
 $('dice').innerHTML=[0,1,2,3].map(i=>dieHTML(g?.dice[i],i,frame)).join('');
 $('diceTitle').textContent=frame.rolling?'주사위가 굴러갑니다…':phase==='choose'?(controlsEnabled()?'오를 열을 선택하세요':'상대가 오를 열을 고르고 있어요'):phase==='bust'?'등반 실패':phase==='decide'?'계속 오를까요, 여기서 멈출까요?':phase==='ended'?'멋진 등반이었습니다':beforeStart()?'설정을 마친 뒤 처음 굴리면 시작합니다':'주사위를 굴려 이번 턴을 시작하세요';
 $('diceHint').textContent=frame.rolling?'주사위가 하나씩 공개됩니다':phase==='bust'?(frame.falling?'이번 턴의 말이 떨어집니다…':'다음 플레이어의 차례로 넘어가세요.'):phase==='choose'?(planned.length?'선택: '+planned.join(' · ')+(selectedOption()?' — 등반을 확인하세요':' — 아직 확인할 수 없는 선택입니다'):'전진할 열을 클릭하세요.'):phase==='decide'?'진행을 저장하거나 한 번 더 도전하세요.':'주사위 네 개를 보고 직접 판단하세요.';
 $('clearSelectionBtn').hidden=!planned.length||phase!=='choose'||frame.rolling;
 $('dragHelp').textContent='한 열에서 두 칸 오르려면 두 번 클릭하세요. 선택이 맞으면 오른쪽의 「등반 확인」을 누르세요.';
}
$('board').addEventListener('click',e=>{
 const column=e.target.closest('[data-column]');if(!column||!isChoosing())return;
 const col=Number(column.dataset.column),count=planned.filter(n=>n===col).length;
 if(count===2)planned=planned.filter(n=>n!==col);
 else if(planned.length===2&&count===1)planned.splice(planned.indexOf(col),1);
 else {if(planned.length===2)planned.shift();planned.push(col);}
 renderBoard();renderDice();renderActions();
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&planned.length){planned=[];renderBoard();renderDice();renderActions();}});
connected();

