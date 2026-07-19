import { io } from 'socket.io-client';
const API = 'http://localhost:4000';
let failures = 0;
const check = (l, ok, extra='') => { if(!ok) failures++; console.log(`${ok?'ok  ':'FAIL'}  ${l}${extra?'  '+extra:''}`); };
const post = async (p,b) => (await fetch(`${API}${p}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)})).json();
const connect = () => new Promise((res,rej)=>{ const s=io(API,{transports:['websocket'],reconnection:false,forceNew:true}); s.on('connect',()=>res(s)); s.on('connect_error',rej); });
const profile = async (t) => (await fetch(`${API}/api/profile/me`,{headers:{Authorization:`Bearer ${t}`}})).json();

const ts = Date.now();
const A = await post('/api/auth/register',{email:`ach${ts}@x.com`,username:'AchAlpha',password:'correct horse battery'});
const B = await post('/api/auth/register',{email:`ach2${ts}@x.com`,username:'AchBeta',password:'correct horse battery'});

const before = await profile(A.token);
check('new player has all achievements locked',
  before.achievements.every(a => a.unlockedAt === null), `${before.achievements.length} defined`);
check('progress bars start empty', before.achievements.every(a => a.fraction === 0));

// play a clean winning match
const sa = await connect(), sb = await connect();
await sa.timeout(3000).emitWithAck('guest:init',{accountToken:A.token});
await sb.timeout(3000).emitWithAck('guest:init',{accountToken:B.token});

let started=null, ended=null;
const first = new Promise(r => sa.once('match:start', p => { started=p; r(p); }));
sa.on('match:end', r => ended = r);

await sa.timeout(3000).emitWithAck('mm:join',{mode:'1v1',characterId:'ninja'});
await sb.timeout(3000).emitWithAck('mm:join',{mode:'1v1',characterId:'samurai'});
await first;

const matchId = started.config.matchId;
let i=0;
while(!ended && i<300){
  sa.emit('match:word',{matchId,wordIndex:i,dirty:false,timings:[70,65,80]});   // flawless
  if(i%4===0) sb.emit('match:word',{matchId,wordIndex:Math.floor(i/4),dirty:true,timings:[130,150]});
  i++; await new Promise(r=>setTimeout(r,50));
}
await new Promise(r=>setTimeout(r,700));

const after = await profile(A.token);
const got = id => after.achievements.find(a=>a.id===id);

check('first victory unlocked', got('first-victory')?.unlockedAt !== null);
check('flawless unlocked by a perfect match', got('flawless')?.unlockedAt !== null,
  `acc ${(after.stats.avgAccuracyBp/100).toFixed(1)}%, ${after.stats.totalWords} words`);
check('chain reaction unlocked by the combo', got('combo-50')?.unlockedAt !== null,
  `combo ${after.stats.bestCombo}`);
check('unearned achievements stay locked', got('hundred-wins')?.unlockedAt === null);
check('partial progress is reported', got('ten-wins')?.progress === 1 && got('ten-wins')?.fraction > 0,
  `${got('ten-wins')?.progress}/${got('ten-wins')?.target}`);
check('achievement XP added on top of match XP', after.progress.xp > 210,
  `${after.progress.xp} xp, level ${after.progress.level}`);

// no double-award on a second match
const xpAfterOne = after.progress.xp;
ended = null;
const second = new Promise(r => sa.once('match:start', p => { started=p; r(p); }));
await sa.timeout(3000).emitWithAck('match:rematch');
await sb.timeout(3000).emitWithAck('match:rematch');
await second;
const m2 = started.config.matchId;
i=0;
while(!ended && i<300){
  sa.emit('match:word',{matchId:m2,wordIndex:i,dirty:false,timings:[70,65,80]});
  if(i%4===0) sb.emit('match:word',{matchId:m2,wordIndex:Math.floor(i/4),dirty:true,timings:[130,150]});
  i++; await new Promise(r=>setTimeout(r,50));
}
await new Promise(r=>setTimeout(r,700));

const third = await profile(A.token);
const gain = third.progress.xp - xpAfterOne;
check('second match does NOT re-award the same achievements', gain < 400, `+${gain} xp`);
check('second win counted', third.stats.wins === 2);
check('streak tracked', third.stats.bestStreak === 2);

console.log(`\n${failures===0?'ALL CHECKS PASSED':failures+' CHECK(S) FAILED'}`);
sa.disconnect(); sb.disconnect();
process.exit(failures===0?0:1);
