(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RollPresentation=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  const REVEAL_AT=[440,660,880,1100],BUST_HOLD_MS=5000,FALL_MS=900;
  function frame(elapsed,bust){
    const revealed=REVEAL_AT.filter(t=>elapsed>=t).length;
    const fallAt=REVEAL_AT[3]+BUST_HOLD_MS;
    return {revealed,rolling:revealed<4,falling:!!bust&&elapsed>=fallAt&&elapsed<fallAt+FALL_MS,
      fallen:!!bust&&elapsed>=fallAt+FALL_MS,
      countdown:!!bust&&revealed===4&&elapsed<fallAt?Math.ceil((fallAt-elapsed)/1000):0};
  }
  function visibleGame(game,animation){
    if(game?.phase!=='bust'||animation.falling||animation.fallen)return game;
    return {...game,phase:'choose',runners:game.bustRunners||{},log:game.log.slice(1),
      message:'전진할 열을 선택한 뒤 등반 확인을 누르세요.'};
  }
  return {REVEAL_AT,BUST_HOLD_MS,FALL_MS,frame,visibleGame};
});
