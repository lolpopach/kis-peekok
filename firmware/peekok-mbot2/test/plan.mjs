// 시험용: 로봇 화면(delivery.js·guide.js)이 서버에 올리는 것과 똑같은 목적지(target)를 만든다.
//   node plan.mjs '{"from":{"floor":4,"x":70,"y":564.5},"room":"f4-12-1"}'   방으로 (부르기·배달·데려다주기)
//   node plan.mjs '{"from":{...},"home":true}'                               제자리로 (돌아가기)
//   node plan.mjs '{"plan":{...},"progress":{...},"now":123,"room":"..."}'   달리는 중 위치(locate)에서 새 계획
//   node plan.mjs '{"course":true}'                                          시범 코스 선 모양(바닥 cm)
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['config', 'data', 'router']) vm.runInContext(fs.readFileSync(path.join(ROOT, `public/js/${f}.js`), 'utf8'), ctx);
const { DATA: D, Router: RT, CONFIG: CFG } = ctx.KIS;
const a = JSON.parse(process.argv[2] || '{}');

if (a.course) {
  const C = D.robotCourse;
  console.log(JSON.stringify({ cm: C.tapeCmPerUnit, nodes: C.nodes, edges: C.edges, rooms: C.rooms, home: C.home }));
  process.exit(0);
}
let from = a.from;
if (!from && a.plan && a.progress) {
  const loc = RT.locate(a.plan, a.progress, a.now || Date.now());
  from = { floor: loc.floor, x: loc.x, y: loc.y };
}
if (!from) from = CFG.robotLocation;
if (a.home) {
  const h = CFG.robotLocation;
  const plan = RT.robotPlanToPoint(from, h);
  console.log(JSON.stringify({ room: null, label: h.label || '제자리', floor: h.floor, x: h.x, y: h.y, plan }));
} else {
  const room = D.roomById(a.room);
  const plan = RT.robotPlan(from, room);
  const end = plan.nodes[plan.nodes.length - 1];
  console.log(JSON.stringify({ room: room.id, label: RT.displayName(room), floor: end.floor, x: end.x, y: end.y, plan }));
}
