'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../public/presentation');
test('four dice reveal sequentially and never permit a result early',()=>{
 assert.equal(P.frame(0,false).revealed,0);
 assert.equal(P.frame(439,false).revealed,0);
 assert.equal(P.frame(440,false).revealed,1);
 assert.equal(P.frame(660,false).revealed,2);
 assert.equal(P.frame(880,false).revealed,3);
 assert.equal(P.frame(1099,false).rolling,true);
 assert.equal(P.frame(1100,false).rolling,false);
});
test('bust stays indistinguishable from choosing until the fall, including logs and runner supply',()=>{
 const game={phase:'bust',runners:{},bustRunners:{6:3,8:2},
   log:[{text:'등반 실패!'},{text:'이전 기록'}],message:'등반 실패!',options:[]};
 for(const elapsed of [0,1100,4000,6099]){
   const visible=P.visibleGame(game,P.frame(elapsed,true));
   assert.equal(visible.phase,'choose');
   assert.deepEqual(visible.runners,{6:3,8:2});
   assert.deepEqual(visible.log,[{text:'이전 기록'}]);
   assert.equal(visible.message.includes('실패'),false);
 }
 for(const elapsed of [6100,6999,7000])assert.equal(P.visibleGame(game,P.frame(elapsed,true)),game);
 assert.equal(game.phase,'bust');
 assert.deepEqual(game.runners,{});
 assert.equal(game.log.length,2);
 const normal={phase:'choose'};
 assert.equal(P.visibleGame(normal,P.frame(1100,false)),normal);
});
test('bust holds for five full seconds after last reveal, then falls and finishes',()=>{
 assert.equal(P.frame(1100,true).countdown,5);
 assert.equal(P.frame(6099,true).falling,false);
 assert.equal(P.frame(6100,true).falling,true);
 assert.equal(P.frame(6999,true).fallen,false);
 assert.equal(P.frame(7000,true).fallen,true);
 assert.equal(P.frame(7000,false).falling,false);
 assert.equal(P.frame(7000,false).fallen,false);
});
