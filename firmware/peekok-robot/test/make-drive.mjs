// 서버의 driveText 로 실제 응답 글자를 만들어 펌웨어 시험에 쓴다 (node make-drive.mjs <폴더>)
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { driveText } = await import(path.join(ROOT, 'lib/shared.js'));

function load(withCourse) {
  const ctx = { console };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['config', 'data', 'router']) {
    if (f === 'router' && !withCourse) ctx.KIS.DATA.robotCourse = null;   // 예전 학교 전체 계획 (엘리베이터 시험용)
    vm.runInContext(fs.readFileSync(path.join(ROOT, `public/js/${f}.js`), 'utf8'), ctx);
  }
  return ctx.KIS;
}
const { DATA, Router, CONFIG } = load(false);
const C = load(true);
const out = process.argv[2];

const targets = {};
async function sample(name, mode, from, roomId) {
  const plan = Router.robotPlan(from, DATA.roomById(roomId));
  const target = { room: roomId, label: roomId, floor: plan.to.floor, x: 0, y: 0, plan };
  targets[name] = target;
  const robot = { mode, target, targetText: JSON.stringify(target), progress: null };
  const text = await driveText(robot).text();
  fs.writeFileSync(`${out}/${name}.txt`, text);
  console.log(`${name}: ${plan.nodes.length} nodes, ${text.length} bytes`);
}
const OLD_HOME = { floor: 1, x: 325, y: 391 };   // 예전 제자리(현관 로비) — 학교 전체 계획 시험용
await sample('to_5-1', 'to_caller', OLD_HOME, 'f2-5-1');
await sample('deliver_health', 'delivering', { floor: 2, x: 358.5, y: 651.2 }, 'f1-보건실');
await sample('to_12-5', 'to_caller', OLD_HOME, 'f4-12-5');
// 시범 코스 (data.js robotCourse): 12-5 → 12-1
{
  const plan = C.Router.robotPlan(C.CONFIG.robotLocation, C.DATA.roomById('f4-12-1'));
  const target = { room: 'f4-12-1', label: '12-1', floor: 4, x: 0, y: 0, plan };
  const text = await driveText({ mode: 'guiding', target, targetText: JSON.stringify(target), progress: null }).text();
  fs.writeFileSync(`${out}/course_12_1.txt`, text);
  console.log(`course_12_1: ${plan.nodes.length} nodes, ${text.length} bytes`);
}
const idle = await driveText({ mode: 'idle', target: null, targetText: null, progress: null }).text();
fs.writeFileSync(`${out}/idle.txt`, idle);
// 엘리베이터에서 '내렸어요'를 누른 뒤 응답 (passed = 2:eL)
// 서버에서는 '내렸어요'(progress)가 계획(target)을 바꾸지 않으므로 같은 target, 같은 rev
const t2 = targets['to_5-1'];
const after = await driveText({ mode: 'to_caller', target: t2, targetText: JSON.stringify(t2), progress: { passed: '2:eL' } }).text();
fs.writeFileSync(`${out}/elevator_out.txt`, after);

