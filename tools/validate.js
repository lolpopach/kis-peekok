#!/usr/bin/env node
/* 도면 데이터 점검 도구
 *   node tools/validate.js            → 모든 방이 로봇 위치에서 갈 수 있는지 점검
 *   node tools/validate.js 보건실 5-1  → 해당 장소의 길 안내 문장 출력
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = { window: {}, console };
ctx.window = ctx;
vm.createContext(ctx);
['public/js/config.js', 'public/js/data.js', 'public/js/router.js'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
});
const { DATA, Router, CONFIG } = ctx.KIS;
const from = CONFIG.robotLocation;

const args = process.argv.slice(2);
if (args.length) {
  args.forEach((q) => {
    const room = DATA.rooms().find((r) => r.name === q || r.id === q || (r.title === q));
    if (!room) { console.log(`✗ "${q}" 없음`); return; }
    ['stairs', 'elevator'].forEach((mode) => {
      const r = Router.route(from, room, { mode });
      console.log(`\n■ ${room.name} (${room.floor}층) [${mode}] 약 ${Math.round(r.meters)}m, ${Math.round(r.seconds)}초${r.fallback ? ' (대체 경로)' : ''}`);
      r.steps.forEach((s, i) => console.log(`  ${i + 1}. [${s.floor}층 ${s.icon}] ${s.text}`));
    });
  });
  process.exit(0);
}

let bad = 0, warn = 0;
DATA.rooms().filter((r) => r.searchable).forEach((room) => {
  const doors = Router.roomDoors(room);
  doors.forEach((d) => {
    if (d.d > 9) { warn++; console.log(`△ 문이 복도에서 멂: ${room.floor}층 ${room.name} (${d.d.toFixed(1)})`); }
  });
  ['stairs', 'elevator'].forEach((mode) => {
    const r = Router.route(from, room, { mode });
    if (!r) { bad++; console.log(`✗ 경로 없음: ${room.floor}층 ${room.name} [${mode}]`); }
    else if (r.fallback) console.log(`△ ${mode} 전용 경로 없음 → 대체 경로: ${room.floor}층 ${room.name}`);
  });
});
console.log(`\n방 ${DATA.rooms().filter((r) => r.searchable).length}개 점검 완료 · 오류 ${bad} · 경고 ${warn}`);
process.exit(bad ? 1 : 0);
