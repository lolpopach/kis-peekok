#!/usr/bin/env node
/* 피콕 주행 시뮬레이터 = 라인 트레이스 로봇 제어 프로그램의 참고 구현
 *
 *   node tools/robot-sim.js --base https://kis-peekok.pages.dev --key <로봇키> [--speed 0.5] [--fast 1] [--once]
 *
 * 실제 로봇이 해야 할 일과 똑같이 동작합니다.
 *   1) GET /api/robot 을 1초마다 불러 지금 모드와 목적지 계획(robot.target.plan)을 받는다
 *   2) 모드가 to_caller · delivering · returning 이고 계획이 있으면 노드를 따라 달린다
 *        plan.nodes[i] = { key, floor, x, y, action, heading, next_m, toFloor? }
 *        action: start → 출발 / straight · left · right · uturn → 그 노드(교차로)에서 할 동작
 *                elevator → 엘리베이터로 toFloor 층까지 / exit → 엘리베이터에서 내리기 / stop → 도착
 *        next_m: 다음 노드까지 거리(m). 직선 구간을 등속도로 달리면 시간으로 위치를 알 수 있다.
 *   3) 노드를 지날 때마다 POST /api/robot/progress { passed, next, speed } → 화면·휴대폰 지도에 실시간 위치
 *   4) 마지막 노드(END)에 닿으면 POST /api/robot/arrived
 *
 * --fast 10 이면 10배 빠르게 (시험용). 실제 로봇은 라인 센서가 교차로를 감지할 때 progress 를 보내면 됩니다.
 */
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return a;
}, []));
const BASE = String(args.base || 'http://127.0.0.1:8788').replace(/\/$/, '');
const KEY = String(args.key || process.env.ROBOT_KEY || 'local-test-key');
const SPEED = Number(args.speed || 0.5);       // m/s
const FAST = Number(args.fast || 1);           // 시간 배속 (시험용)
const ELEVATOR_S = Number(args.elevator || 8); // 엘리베이터 한 번 타는 데 걸리는 시간(초)
const ONCE = !!args.once;                      // 한 번 도착하면 끝내기
const sleep = (ms) => new Promise((r) => setTimeout(r, ms / FAST));
const log = (...m) => console.log(new Date().toLocaleTimeString('ko-KR'), ...m);

async function api(method, path, body) {
  const res = await fetch(BASE + '/api/robot' + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-robot-key': KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${data.error || ''}`);
  return data;
}

const SAY = { start: '출발', straight: '직진', left: '좌회전', right: '우회전', uturn: '유턴', elevator: '엘리베이터', exit: '엘리베이터에서 내림', stop: '정지' };

async function drive(plan, mode, signature) {
  const nodes = plan.nodes;
  log(`▶ ${mode}: ${plan.to && plan.to.label} 까지 ${plan.total_m}m, 노드 ${nodes.length}개`);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i], next = nodes[i + 1];
    // 계획이 바뀌었으면(취소·새 목적지) 멈춘다
    const now = await api('GET', '');
    if (JSON.stringify(now.robot.target && now.robot.target.plan) !== signature || now.robot.mode !== mode) { log('■ 계획이 바뀌어 멈춤'); return false; }
    if (!next) break;
    await api('POST', '/progress', { passed: n.key, next: next.key, speed: SPEED });
    log(`  ${n.key.padEnd(7)} ${SAY[n.action] || n.action}${n.heading ? ` → ${n.heading}` : ''}${n.toFloor ? ` ${n.toFloor}층` : ''}  (다음 ${next.key}, ${n.next_m || 0}m)`);
    if (n.action === 'elevator') await sleep(ELEVATOR_S * 1000);
    else await sleep(((n.next_m || 0) / SPEED) * 1000);
  }
  await api('POST', '/arrived', {});
  log(`● 도착: ${plan.to && plan.to.label}`);
  return true;
}

(async () => {
  log(`피콕 주행 시뮬레이터 — ${BASE}  속도 ${SPEED}m/s × ${FAST}배`);
  let lastSig = null;
  for (;;) {
    try {
      const s = await api('GET', '');
      const r = s.robot;
      const plan = r.target && r.target.plan;
      const sig = JSON.stringify(plan);
      if (['to_caller', 'delivering', 'returning'].includes(r.mode) && plan && sig !== lastSig) {
        lastSig = sig;
        const ok = await drive(plan, r.mode, sig);
        if (ok && ONCE) process.exit(0);
      }
    } catch (e) {
      log('연결 오류:', e.message);
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
})();
