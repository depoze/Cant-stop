'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const G=require('../game');
function game(){return G.createGame(['A','B']);}
function dice(values){let i=0;return ()=>values[i++];}
test('standard column heights and fresh turn',()=>{
 const g=game();assert.equal(Object.values(G.HEIGHTS).reduce((a,b)=>a+b),83);
 assert.equal(g.turn,0);assert.deepEqual(g.runners,{});assert.equal(g.phase,'setup');
});
test('double sum advances twice and chosen move can be banked',()=>{
 const g=game();G.roll(g,dice([1,1,1,1]));
 assert.equal(g.options[0].runners[2],2);G.choose(g,g.options[0].id,g.rollId);G.bank(g);
 assert.equal(g.players[0].progress[2],2);assert.equal(g.turn,1);assert.deepEqual(g.runners,{});
});
test('last runner offers either new column, but never a fourth runner',()=>{
 const g=game();g.runners={2:1,3:1};
 const options=G.getOptions(g,[1,3,5,6]).filter(o=>o.pairIndex===0);
 assert.equal(options.length,2);assert.deepEqual(options.map(o=>o.advances[0]).sort((a,b)=>a-b),[4,11]);
 for(const o of options)assert.equal(Object.keys(o.runners).length,3);
});
test('available new runner is mandatory alongside an existing runner',()=>{
 const g=game();g.runners={3:1,6:1};
 const option=G.getOptions(g,[2,4,5,5]).find(o=>o.pairIndex===0);
 assert.deepEqual(option.advances,[6,10]);assert.equal(option.runners[10],1);
});
test('bust removes only temporary progress and waits for acknowledgement',()=>{
 const g=game();g.runners={2:1,3:1,4:1};g.players[0].progress={3:1};g.phase='decide';
 G.roll(g,dice([6,6,6,6]));
 assert.equal(g.phase,'bust');assert.deepEqual(g.runners,{});assert.equal(g.players[0].progress[3],1);
 G.continueAfterBust(g);assert.equal(g.turn,1);assert.equal(g.phase,'roll');
});
test('summit is provisional, not reusable, and can be lost on a bust',()=>{
 const g=game();g.runners={2:3,3:5,4:7};g.phase='decide';
 G.roll(g,dice([1,1,1,1]));assert.equal(g.phase,'bust');assert.deepEqual(g.claimed,{});
});
test('claim removes opponent progress and closes column to everyone',()=>{
 const g=game();g.players[1].progress[2]=2;g.runners={2:3};g.phase='decide';G.bank(g);
 assert.equal(g.claimed[2],0);assert.equal(g.players[1].progress[2],undefined);
 assert.equal(G.getOptions(g,[1,1,1,1]).length,0);
});
test('three banked columns win, double sums never exceed summit',()=>{
 const g=game();g.players[0].progress[2]=2;
 const o=G.getOptions(g,[1,1,1,1])[0];assert.equal(o.runners[2],3);assert.equal(o.advances.length,1);
 g.claimed={3:0,4:0};g.runners=o.runners;g.phase='decide';G.bank(g);
 assert.equal(g.winner,0);assert.equal(g.phase,'ended');
});
test('stale roll, illegal choice and wrong phase are rejected',()=>{
 const g=game();assert.throws(()=>G.bank(g));G.roll(g,dice([1,2,3,4]));
 assert.throws(()=>G.choose(g,'bad',g.rollId));assert.throws(()=>G.choose(g,g.options[0].id,g.rollId-1));
 assert.throws(()=>G.roll(g,dice([1,1,1,1])));
});
test('all 1296 rolls preserve runner limits and legal bounds',()=>{
 for(const runners of [{},{2:2,7:5},{2:3,7:12,12:2}]) {
  const g=game();g.runners=runners;g.claimed={4:1};
  for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)for(let d=1;d<=6;d++) {
   for(const o of G.getOptions(g,[a,b,c,d])) {
    assert.ok(o.advances.length>=1&&o.advances.length<=2);
    assert.ok(Object.keys(o.runners).length<=3);
    for(const [col,pos] of Object.entries(o.runners)){assert.ok(pos<=G.HEIGHTS[col]);assert.notEqual(Number(col),4);}
   }
  }
 }
});

test('two legal pairs must both be used; bank and reroll wait for second pair',()=>{
 const g=game();G.roll(g,dice([2,6,3,6]));
 G.choosePair(g,[0,1],g.rollId);
 assert.equal(g.runners[8],1);assert.equal(g.runners[9],undefined);assert.equal(g.phase,'choose');
 assert.throws(()=>G.bank(g));assert.throws(()=>G.roll(g,dice([1,1,1,1])));
 assert.throws(()=>G.choosePair(g,[0,2],g.rollId));
 G.choosePair(g,[2,3],g.rollId);assert.equal(g.phase,'decide');assert.equal(g.runners[9],1);
});
test('one legal pair suffices when other column is closed or all runners are used',()=>{
 for(const closed of [true,false]){
  const g=game();if(closed)g.claimed[9]=1;else g.runners={2:1,3:1,8:1};
  G.roll(g,dice([2,6,3,6]));G.choosePair(g,[0,1],g.rollId);
  assert.equal(g.phase,'decide');assert.equal(g.runners[9],undefined);G.bank(g);
 }
});
test('2 3 6 6 reports unique sums 5 8 9 12',()=>{
 const g=game();G.roll(g,dice([2,3,6,6]));
 assert.deepEqual([...new Set(G.availablePairs(g).map(p=>p.sum))].sort((a,b)=>a-b),[5,8,9,12]);
});
test('selected first player starts with two runners only on the first turn',()=>{
 const g=G.createGame(['A','B','C'],{firstPlayer:2,firstTurnPenalty:true});
 assert.equal(g.phase,'setup');assert.equal(g.turn,2);assert.equal(G.runnerLimit(g),2);
 G.roll(g,dice([2,6,3,6]));G.choosePair(g,[0,1],g.rollId);G.choosePair(g,[2,3],g.rollId);
 G.roll(g,dice([1,1,2,2]));assert.equal(g.phase,'bust');G.continueAfterBust(g);
 assert.equal(g.turn,0);assert.equal(G.runnerLimit(g),3);
 g.turn=2;g.turnNumber=4;assert.equal(G.runnerLimit(g),3);
});
test('penalty rejects a third runner yet permits advancing the existing two',()=>{
 const g=G.createGame(['A','B'],{firstTurnPenalty:true});g.runners={8:2,9:3};g.phase='decide';
 G.roll(g,dice([2,6,3,6]));
 assert.ok(G.availablePairs(g).every(p=>[8,9].includes(p.sum)));
 assert.throws(()=>G.choosePair(g,[0,2],g.rollId));
 G.choosePair(g,[0,1],g.rollId);G.choosePair(g,[2,3],g.rollId);
 assert.deepEqual(g.runners,{8:3,9:4});
});
test('sequential pair moves match whole-roll legality across every dice result',()=>{
 for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)for(let d=1;d<=6;d++){
  const g=G.createGame(['A','B'],{firstTurnPenalty:true});g.runners={7:4};g.claimed={12:1};
  G.roll(g,dice([a,b,c,d]));if(g.phase==='bust')continue;
  const expected=new Set(g.options.map(o=>JSON.stringify(o.runners)));
  for(const pair of G.availablePairs(g)){
   const copy=G.clone(g);G.choosePair(copy,pair.indices,copy.rollId);
   if(copy.phase==='choose')G.choosePair(copy,G.availablePairs(copy)[0].indices,copy.rollId);
   assert.equal(copy.phase,'decide');assert.ok(expected.has(JSON.stringify(copy.runners)));
   assert.ok(Object.keys(copy.runners).length<=2);
  }
 }
});

test('column confirmation is atomic and rejects an incomplete or impossible selection',()=>{
 const g=game();G.roll(g,dice([2,3,6,6]));const before=G.clone(g);
 for(const columns of [[8],[5,8],[8,8],[],[5,12,8],['8',9]]){
  assert.throws(()=>G.confirmClimb(g,columns,g.rollId));
  assert.deepEqual(g.runners,before.runners);assert.equal(g.phase,'choose');
 }
 G.confirmClimb(g,[9,8],g.rollId);
 assert.deepEqual(g.runners,{8:1,9:1});assert.equal(g.phase,'decide');
});
test('double column requires two clicks, single allowed only when the other advance cannot be made',()=>{
 const g=game();G.roll(g,dice([3,3,3,3]));
 assert.throws(()=>G.confirmClimb(g,[6],g.rollId));
 G.confirmClimb(g,[6,6],g.rollId);assert.equal(g.runners[6],2);
 const one=game();one.claimed[9]=1;G.roll(one,dice([2,6,3,6]));
 G.confirmClimb(one,[8],one.rollId);assert.deepEqual(one.runners,{8:1});
});
test('bust retains a visual snapshot without keeping lost progress in the rules state',()=>{
 const g=game();g.phase='decide';g.runners={2:1,3:2,4:3};g.players[0].progress={2:1};
 G.roll(g,dice([6,6,6,6]));
 assert.deepEqual(g.bustRunners,{2:1,3:2,4:3});assert.deepEqual(g.runners,{});
 assert.deepEqual(g.players[0].progress,{2:1});
 G.continueAfterBust(g);assert.deepEqual(g.bustRunners,{});
});
