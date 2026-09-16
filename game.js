'use strict';
const HEIGHTS = Object.freeze({2:3,3:5,4:7,5:9,6:11,7:13,8:11,9:9,10:7,11:5,12:3});
const PAIRS = [[[0,1],[2,3]], [[0,2],[1,3]], [[0,3],[1,2]]];
const COLORS = ['#e26363','#578fdb','#4ba88c','#ca9b43'];
const clone = value => JSON.parse(JSON.stringify(value));

function createGame(names,settings={}) {
  return { players: names.map((name,i) => ({name, color:COLORS[i], progress:{}})),
    phase:'setup', turn:settings.firstPlayer ?? 0, firstPlayer:settings.firstPlayer ?? 0, firstTurnPenalty:!!settings.firstTurnPenalty, turnNumber:1, dice:[], usedDice:[], runners:{}, claimed:{},
    winner:null, moves:0, rollId:0, options:[], log:[], message:'선후공과 선공 패널티를 정한 뒤, 선공 플레이어가 굴리면 시작합니다.' };
}

function addLog(g,text) {
  g.message = text;
  g.log.unshift({text, turn:g.turnNumber});
  g.log = g.log.slice(0,40);
}

function runnerLimit(g) { return g.firstTurnPenalty && g.turnNumber===1 ? 2 : 3; }
function step(g,runners,col) {
  if (g.claimed[col] !== undefined) return false;
  if (runners[col] === undefined && Object.keys(runners).length >= runnerLimit(g)) return false;
  const position = runners[col] ?? g.players[g.turn].progress[col] ?? 0;
  if (position >= HEIGHTS[col]) return false;
  runners[col] = position + 1;
  return true;
}

// Both orders matter when just one runner remains and two new columns are rolled.
function getOptions(g,dice) {
  const result=[];
  PAIRS.forEach((pairs,pairIndex) => {
    const sums=pairs.map(([a,b]) => dice[a]+dice[b]);
    const seen=new Set();
    for (const order of [[0,1],[1,0]]) {
      const runners={...g.runners}, advances=[];
      for (const index of order) if(step(g,runners,sums[index])) advances.push(sums[index]);
      if (!advances.length) continue;
      const key=JSON.stringify(Object.entries(runners).sort((a,b)=>Number(a[0])-Number(b[0])));
      if(seen.has(key)) continue;
      seen.add(key);
      result.push({id:pairIndex+'-'+order[0], pairIndex, pairs, sums, advances, runners});
    }
  });
  return result;
}

function roll(g, randomDie) {
  if(!['setup','roll','decide'].includes(g.phase)) throw new Error('지금은 주사위를 굴릴 수 없습니다.');
  g.dice=Array.from({length:4},randomDie);
  g.rollId++; g.usedDice=[]; g.bustRunners={};
  g.options=getOptions(g,g.dice);
  if(!g.options.length) {
    g.bustRunners={...g.runners}; g.runners={}; g.phase='bust';
    addLog(g,g.players[g.turn].name+' 님의 등반 실패! 이번 턴의 전진이 사라졌습니다.');
  } else {
    g.phase='choose';
    g.message='전진할 열을 선택한 뒤 등반 확인을 누르세요.';
  }
}


function confirmClimb(g,columns,rollId){
  if(g.phase!=='choose'||g.rollId!==rollId)throw new Error('현재 주사위에 맞는 열을 선택해 주세요.');
  if(!Array.isArray(columns)||columns.length<1||columns.length>2||
    columns.some(c=>!Number.isInteger(c)||!HEIGHTS[c]))throw new Error('전진할 열을 한 번 또는 두 번 선택해 주세요.');
  const key=[...columns].sort((a,b)=>a-b).join(',');
  const option=g.options.find(o=>[...o.advances].sort((a,b)=>a-b).join(',')===key);
  if(!option)throw new Error('주사위 조합과 이동 규칙에 맞지 않는 선택입니다.');
  choose(g,option.id,rollId);
}
function choose(g,id,rollId) {
  if(g.phase!=='choose' || rollId!==g.rollId) throw new Error('현재 주사위 조합을 선택해 주세요.');
  const option=g.options.find(o=>o.id===id);
  if(!option) throw new Error('이 조합으로는 전진할 수 없습니다.');
  g.runners={...option.runners}; g.options=[]; g.phase='decide';
  g.moves++;
  g.message=option.advances.join(' · ')+'번 열 전진! 계속 도전하거나 진행을 저장하세요.';
}


function availablePairs(g) {
  const remaining=[0,1,2,3].filter(i=>!g.usedDice.includes(i)),result=[];
  for(let a=0;a<remaining.length;a++) for(let b=a+1;b<remaining.length;b++){
    const indices=[remaining[a],remaining[b]],sum=indices.reduce((n,i)=>n+g.dice[i],0);
    if(step(g,{...g.runners},sum))result.push({indices,sum});
  }
  return result;
}
function choosePair(g,indices,rollId) {
  if(g.phase!=='choose'||g.rollId!==rollId)throw new Error('현재 주사위 두 개를 선택해 주세요.');
  if(!Array.isArray(indices)||indices.length!==2||indices[0]===indices[1]||
    indices.some(i=>!Number.isInteger(i)||i<0||i>3||g.usedDice.includes(i)))throw new Error('사용하지 않은 주사위 두 개가 필요합니다.');
  const sum=indices.reduce((n,i)=>n+g.dice[i],0),runners={...g.runners};
  if(!step(g,runners,sum))throw new Error('이 숫자로는 전진할 수 없습니다.');
  g.runners=runners;g.usedDice.push(...indices);g.moves++;
  const remaining=availablePairs(g);
  if(g.usedDice.length<4&&remaining.length) {
    g.options=getOptions(g,g.dice);
    g.message=sum+'번 열 전진. 남은 두 주사위의 합 '+remaining[0].sum+'도 사용해야 합니다.';
  } else {
    g.phase='decide';g.options=[];
    g.message=sum+'번 열 전진! '+(g.usedDice.length===2?'남은 쌍은 이동할 수 없습니다. ':'')+'계속 도전하거나 진행을 저장하세요.';
  }
}
function nextTurn(g) {
  g.runners={}; g.bustRunners={}; g.dice=[]; g.usedDice=[]; g.options=[]; g.phase='roll';
  g.turn=(g.turn+1)%g.players.length; g.turnNumber++;
}

function bank(g) {
  if(g.phase!=='decide') throw new Error('전진한 후에 저장할 수 있습니다.');
  const p=g.players[g.turn], won=[];
  for(const [col,pos] of Object.entries(g.runners)) {
    p.progress[col]=pos;
    if(pos===HEIGHTS[col]) {
      g.claimed[col]=g.turn; won.push(col);
      g.players.forEach((other,i)=>{if(i!==g.turn) delete other.progress[col];});
    }
  }
  addLog(g,p.name+' 님이 진행을 저장했습니다.'+(won.length?' '+won.join(' · ')+'번 열 선점!':''));
  g.runners={};
  if(Object.values(g.claimed).filter(i=>i===g.turn).length>=3) {
    g.winner=g.turn; g.phase='ended';
    addLog(g,p.name+' 님 승리! 3개 열을 가장 먼저 선점했습니다.');
  } else nextTurn(g);
}

function continueAfterBust(g) {
  if(g.phase!=='bust') throw new Error('등반 실패 후에만 다음 턴으로 넘어갑니다.');
  nextTurn(g);
}
module.exports={confirmClimb,runnerLimit,availablePairs,choosePair,HEIGHTS,PAIRS,COLORS,createGame,getOptions,roll,choose,bank,continueAfterBust,clone};
