/* 로봇 주행: "데려다주기" 안내 방식의 경로 계획 · 위치 추적 · 통신 연결부
 *
 * 설계 문서 "피콕 라인 트레이스 위치 추적 설계"를 따릅니다.
 *  - 바닥 라인은 1층 핵심 순환로(아래 LINE_EDGES)에만 깔고, 로봇은 그 위로만 다닙니다.
 *  - 목적지가 라인 밖이면 라인 위에서 목적지에 가장 가까운 노드까지 데려다준 뒤 나머지는 QR 코드로 넘깁니다.
 *  - 데려다준 뒤에는 혼자 집 노드(로비)로 돌아갑니다. 엘리베이터는 쓰지 않습니다.
 *
 * ESP32 연결부 (아직 로봇 없음)
 *  - 기본은 시뮬레이터(SimTransport)라서 로봇 없이도 화면 흐름을 확인할 수 있습니다.
 *  - 실제 로봇은 같은 모양의 transport 를 만들어 KIS.Robot.useTransport(t) 로 바꿔 끼우면 됩니다.
 *      t.send(obj)            웹 → ESP32 지시   {cmd:'plan'|'start'|'stop'|'speed', …}
 *      t.onmessage = (obj)=>  ESP32 → 웹 보고   {t:'go'|'node'|'turn'|'pause'|'resume'|'lost', …}
 *    BLE(Web Bluetooth)라면 write 특성으로 JSON 한 줄을 쓰고, notify 특성에서 받은 줄을 JSON.parse 해서 onmessage 로 넘깁니다.
 */
window.KIS = window.KIS || {};

KIS.Robot = (function () {
  const CFG = KIS.CONFIG, RT = KIS.Router;
  const RC = Object.assign({
    enabled: true,
    floor: 1,               // 프로토타입: 1층만
    speedMps: 0.5,          // 데려다주기 주행 속도 (사람이 편히 따라올 속도, 실제 로봇으로 정할 값)
    turnSec: 1.5,           // 노드에서 제자리 회전에 걸리는 시간 (시뮬레이터·예상 시간용)
    turnCost: 20,           // 로봇 경로: 회전 한 번 벌점 (도면 단위 ≈ 5m)
    uturnCost: 40,          // 로봇 경로: U턴 벌점
    arriveMeters: 15,       // 멈춘 곳에서 목적지 문까지 이보다 가까우면 "도착", 멀면 나머지를 QR 로 넘김
    maxHomeGap: 12,         // 로봇 위치가 라인 노드에서 이보다 멀면(도면 단위) 데려다주기 불가
    homeHeading: 'N',       // 집 노드에서 로봇이 바라보는 방향
    // 바닥 라인 = 1층 핵심 순환로 (설계 문서 "효율적인 동선을 위한 노드 배치" 1단계)
    lineEdges: 'L-b2 b2-r5 r5-r4 r4-r3 r3-r2 r2-r1 r1-c2 c2-c3 c3-o1 o1-m3 m3-m2 ' +
      'b2-b3 b3-n3 n3-k2 k2-o2 o2-t4 o1-o2',
  }, CFG.robot || {});
  const F = RC.floor;
  const UNIT = CFG.metersPerUnit;
  const v = RC.speedMps / UNIT; // 도면 단위/초
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  /* ── 로봇 주행 그래프 (사람 길안내 그래프와 별도) ── */
  const P = {};   // 노드 id → [x, y]
  const adj = {};
  RC.lineEdges.trim().split(/\s+/).forEach((pair) => {
    const [a, b] = pair.split('-');
    const na = RT.debug.nodes[`${F}:${a}`], nb = RT.debug.nodes[`${F}:${b}`];
    if (!na || !nb) { console.warn('[robot] 라인에 없는 노드:', pair); return; }
    P[a] = [na.x, na.y]; P[b] = [nb.x, nb.y];
    (adj[a] = adj[a] || []).push(b);
    (adj[b] = adj[b] || []).push(a);
  });
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const len = (a, b) => dist(P[a], P[b]);
  const HEAD = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
  function dirOf(a, b) {
    const dx = P[b][0] - P[a][0], dy = P[b][1] - P[a][1];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  }
  // 화면 좌표(y 아래로 증가): 외적 + = 오른쪽. router.js 의 turnDir 와 같은 규칙
  function turnOf(h, t) {
    const cross = h[0] * t[1] - h[1] * t[0], dot = h[0] * t[0] + h[1] * t[1];
    if (dot < -0.7) return 'U';
    if (Math.abs(cross) < 0.3) return 'S';
    return cross > 0 ? 'R' : 'L';
  }
  const penalty = (turn) => (turn === 'S' ? 0 : turn === 'U' ? RC.uturnCost : RC.turnCost);

  /* 회전에 벌점을 주는 최단 경로: 상태 = (노드, 들어온 방향) */
  function shortest(start, heading, goal) {
    if (start === goal) return { nodes: [start], cost: 0 };
    const best = {}, prev = {};
    const k0 = `${start}|`;
    best[k0] = 0;
    const q = [{ c: 0, node: start, h: heading, key: k0 }];
    let end = null;
    while (q.length) {
      let bi = 0;
      for (let i = 1; i < q.length; i++) if (q[i].c < q[bi].c) bi = i;
      const cur = q.splice(bi, 1)[0];
      if (cur.c > best[cur.key]) continue;
      if (cur.node === goal) { end = cur; break; }
      (adj[cur.node] || []).forEach((nb) => {
        const t = dirOf(cur.node, nb);
        const c = cur.c + len(cur.node, nb) + (cur.h ? penalty(turnOf(cur.h, t)) : 0);
        const key = `${nb}|${cur.node}`;
        if (best[key] === undefined || c < best[key]) { best[key] = c; prev[key] = cur.key; q.push({ c, node: nb, h: t, key }); }
      });
    }
    if (!end) return null;
    const nodes = [];
    for (let k = end.key; k; k = prev[k]) nodes.unshift(k.split('|')[0]);
    return { nodes, cost: end.c };
  }

  /* 노드 목록 → ESP32 에 보낼 회전 목록 (설계 문서 "출발 전: 경로를 회전 목록으로 바꾸기") */
  function toTurns(nodes, heading) {
    const pre = nodes.length > 1 && heading ? turnOf(heading, dirOf(nodes[0], nodes[1])) : 'S';
    const turns = [];
    for (let i = 1; i < nodes.length; i++) {
      turns.push(i === nodes.length - 1 ? 'STOP' : turnOf(dirOf(nodes[i - 1], nodes[i]), dirOf(nodes[i], nodes[i + 1])));
    }
    return { pre, turns };
  }
  function pathUnits(nodes) {
    let s = 0;
    for (let i = 1; i < nodes.length; i++) s += len(nodes[i - 1], nodes[i]);
    return s;
  }
  function travelSec(nodes, pre, turns) {
    const nTurns = (pre !== 'S' ? 1 : 0) + turns.filter((t) => t !== 'S' && t !== 'STOP').length;
    return pathUnits(nodes) / v + nTurns * RC.turnSec;
  }

  // 노드를 사람이 알아듣는 이름으로: 가장 가까운 장소 + "앞"
  function placeName(id) {
    if (!P[id]) return '';
    const lm = RT.landmark(F, P[id], 30);
    return lm ? `${RT.displayName(lm)} 앞` : '복도';
  }

  /* ── 로봇 상태 ── */
  let home = null;        // { node, heading }
  let at = null;          // 지금 서 있는 노드 { node, heading }
  let run = null;         // 주행 중인 계획
  let planId = 0;
  const listeners = {};
  const emit = (ev, data) => (listeners[ev] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });

  function nearestNode(p) {
    let best = null;
    Object.keys(P).forEach((id) => {
      const d = dist(P[id], p);
      if (!best || d < best.d) best = { id, d };
    });
    return best;
  }

  // 로봇의 집 (관리자 화면의 로봇 위치). 라인 위 가장 가까운 노드가 집 노드가 된다.
  function setHome(loc) {
    home = null;
    if (!RC.enabled || !loc || loc.floor !== F) { if (!run) at = null; return; }
    const n = nearestNode([loc.x, loc.y]);
    if (!n || n.d > RC.maxHomeGap) { if (!run) at = null; return; }
    home = { node: n.id, heading: HEAD[RC.homeHeading] || null };
    if (!run) at = Object.assign({}, home);
  }

  /* 데려다주기 계획: 어디까지 데려가고, 거기서 목적지까지 남는 길은 얼마인지
   *  - 라인 위 노드마다 "거기서 목적지까지 걸어갈 거리"를 구해 가장 짧은 곳에 세운다
   *    (로봇이 많이 돌아가지 않도록 로봇 주행 거리도 조금 반영)
   *  - 다른 층 목적지는 계단 앞 노드까지 데려다주고 나머지는 QR 로 */
  function planFor(room, opts = {}) {
    if (!RC.enabled) return { ok: false, reason: '데려다주기를 쓰지 않도록 설정되어 있어요' };
    if (run) return { ok: false, reason: run.kind === 'return' ? '피콕이 로비로 돌아가는 중이에요' : '피콕이 다른 분을 안내하고 있어요' };
    if (!home || !at) return { ok: false, reason: `피콕은 ${F}층 안내 선 위에서만 움직일 수 있어요` };
    const mode = opts.mode === 'elevator' ? 'elevator' : 'stairs';
    let best = null;
    Object.keys(P).forEach((id) => {
      const rest = RT.route({ floor: F, x: P[id][0], y: P[id][1], label: placeName(id) }, room, { mode });
      if (!rest) return;
      const sp = shortest(at.node, at.heading, id);
      if (!sp) return;
      const score = rest.meters + 0.1 * sp.cost * UNIT;
      if (!best || score < best.score) best = { id, rest, sp, score };
    });
    if (!best) return { ok: false, reason: '로봇이 갈 수 있는 길을 찾지 못했어요' };
    if (best.sp.nodes.length < 2) return { ok: false, reason: '목적지가 바로 가까이에 있어요' };
    const { pre, turns } = toTurns(best.sp.nodes, at.heading);
    const handoff = room.floor !== F || best.rest.meters > RC.arriveMeters;
    return {
      ok: true, room, mode,
      nodes: best.sp.nodes, pre, turns,
      stop: best.id, stopName: placeName(best.id), stopAt: { floor: F, x: P[best.id][0], y: P[best.id][1] },
      meters: pathUnits(best.sp.nodes) * UNIT,
      seconds: travelSec(best.sp.nodes, pre, turns),
      rest: best.rest,          // 멈춘 곳 → 목적지 (사람 길안내 경로)
      handoff,                  // true 면 나머지는 QR 로
      draw: best.sp.nodes.map((id) => P[id].slice()),
    };
  }

  /* ── 주행 시작 · 멈춤 · 귀환 ── */
  function begin(kind, nodes, pre, turns, extra = {}) {
    planId++;
    run = Object.assign({
      id: planId, kind, nodes, pre, turns,
      idx: 0, moving: false, turning: pre !== 'S', t0: 0, pauseMs: 0, pausedAt: 0, paused: false, lost: false,
      total: pathUnits(nodes),
    }, extra);
    at = null;
    transport.send({ cmd: 'speed', cm_s: Math.round(RC.speedMps * 100) });
    transport.send({ cmd: 'plan', id: run.id, pre, turns, nodes: nodes.slice(), floor: F });
    transport.send({ cmd: 'start' });
    emit('start', status());
  }

  function escort(plan) {
    if (!plan || !plan.ok || run) return false;
    begin('escort', plan.nodes, plan.pre, plan.turns, { plan });
    return true;
  }

  // 지금 위치에서 집으로. 간선 중간이면 앞 노드로 계속 가거나 U턴해서 뒤 노드로 간다.
  function returnHome() {
    if (!home) { stopAll(); return false; }
    let startNode, heading, prefix = null;
    if (run) {
      const p = pose();
      const a = run.nodes[run.idx], b = run.nodes[run.idx + 1];
      if (run.moving && b && p.s > 0.5) {
        P['@'] = [p.x, p.y];
        const h = dirOf(a, b);
        const viaB = shortest(b, h, home.node), viaA = shortest(a, [-h[0], -h[1]], home.node);
        const cb = viaB ? len('@', b) + viaB.cost : Infinity;
        const ca = viaA ? len('@', a) + viaA.cost + RC.uturnCost : Infinity;
        const pick = cb <= ca ? viaB : viaA;
        if (!pick) { stopAll(); return false; }
        prefix = ['@'];
        startNode = pick.nodes;
        heading = h;
      } else {
        startNode = a;
        heading = run.idx > 0 ? dirOf(run.nodes[run.idx - 1], a) : (at && at.heading);
      }
      transport.send({ cmd: 'stop' });
      run = null;
    } else {
      if (!at) return false;
      startNode = at.node; heading = at.heading;
    }
    let nodes;
    if (prefix) nodes = prefix.concat(startNode);
    else {
      const sp = shortest(startNode, heading, home.node);
      if (!sp) return false;
      nodes = sp.nodes;
    }
    if (nodes.length < 2) { at = Object.assign({}, home); emit('home', null); return true; }
    const { pre, turns } = toTurns(nodes, heading);
    begin('return', nodes, pre, turns);
    return true;
  }

  function pause() { if (run && !run.paused) transport.send({ cmd: 'stop' }); }
  function resume() { if (run && run.paused) transport.send({ cmd: 'start' }); }
  function stopAll() { transport.send({ cmd: 'stop' }); run = null; }

  /* ── ESP32 보고 처리 ── */
  function receive(msg) {
    if (!msg || !run) return;
    const t = now();
    switch (msg.t) {
      case 'go': run.moving = true; run.turning = false; run.t0 = t; run.pauseMs = 0; break;
      case 'turn': run.turning = false; run.moving = true; run.t0 = t; run.pauseMs = 0; emit('turn', status()); break;
      case 'node': {
        run.idx++;
        run.pauseMs = 0;
        const last = run.nodes.length - 1;
        if (run.idx >= last) {
          run.idx = last;
          const node = run.nodes[last];
          const heading = run.kind === 'return' ? home && home.heading : dirOf(run.nodes[last - 1], node);
          const done = run;
          run = null;
          at = { node, heading };
          emit(done.kind === 'return' ? 'home' : 'arrive', { plan: done.plan, node });
          return;
        }
        const turn = run.turns[run.idx - 1];
        if (turn === 'S') { run.moving = true; run.t0 = t; } else { run.moving = false; run.turning = true; }
        emit('node', Object.assign(status(), { turn }));
        break;
      }
      case 'pause': if (!run.paused) { run.paused = true; run.pausedAt = t; emit('pause', status()); } break;
      case 'resume': if (run.paused) { run.paused = false; run.pauseMs += t - run.pausedAt; emit('resume', status()); } break;
      case 'lost': run.lost = true; run.paused = true; run.pausedAt = t; emit('lost', status()); break;
      default: break;
    }
  }

  /* ── 지금 위치 (등속 추정, 노드에서 보정) ── */
  function pose() {
    if (!run) {
      if (!at) return null;
      const h = at.heading || [0, -1];
      return { floor: F, x: P[at.node][0], y: P[at.node][1], angle: Math.atan2(h[1], h[0]) * 180 / Math.PI, s: 0, remaining: 0 };
    }
    const a = run.nodes[run.idx], b = run.nodes[run.idx + 1];
    const L = b ? len(a, b) : 0;
    let s = 0;
    if (run.moving && b) {
      const pausedNow = run.paused ? now() - run.pausedAt : 0;
      s = Math.max(0, Math.min(L * 0.97, v * (now() - run.t0 - run.pauseMs - pausedNow) / 1000));
    }
    const k = L ? s / L : 0;
    const h = b ? dirOf(a, b) : [0, -1];
    let after = 0;
    for (let i = run.idx + 1; i < run.nodes.length - 1; i++) after += len(run.nodes[i], run.nodes[i + 1]);
    return {
      floor: F, x: P[a][0] + (b ? (P[b][0] - P[a][0]) * k : 0), y: P[a][1] + (b ? (P[b][1] - P[a][1]) * k : 0),
      angle: Math.atan2(h[1], h[0]) * 180 / Math.PI, from: a, to: b, s, L, remaining: (L - s) + after,
    };
  }

  function status() {
    if (!run) return { kind: null };
    const p = pose();
    const next = run.nodes[run.idx + 1];
    const nextTurn = next ? run.turns[run.idx] : null;
    // 앞으로 처음 만나는 회전 (직진 노드는 건너뜀)
    let turnAt = null, turnDir = null;
    for (let i = run.idx; i < run.turns.length; i++) {
      if (run.turns[i] !== 'S') { turnAt = run.nodes[i + 1]; turnDir = run.turns[i]; break; }
    }
    return {
      kind: run.kind, plan: run.plan, paused: run.paused, lost: run.lost, turning: run.turning,
      pose: p, remainingM: p.remaining * UNIT, progress: run.total ? 1 - p.remaining / run.total : 1,
      etaSec: p.remaining / v, next, nextTurn, turnAt, turnDir, turnAtName: placeName(turnAt), fromName: placeName(run.nodes[run.idx]),
    };
  }

  /* ── 시뮬레이터: ESP32 대신 같은 보고를 시간에 맞춰 보냄 ── */
  function SimTransport() {
    const api = { name: 'sim', onmessage: null };
    let plan = null, i = 0, timer = null, due = 0, pending = null, remain = 0, stopped = false, speed = v;
    const out = (m) => setTimeout(() => api.onmessage && api.onmessage(m), 0);
    const schedule = (fn, ms) => { pending = fn; due = now() + ms; timer = setTimeout(() => { pending = null; fn(); }, ms); };
    const clear = () => { clearTimeout(timer); pending = null; };
    const segLen = (k) => {
      const a = plan.nodes[k], b = plan.nodes[k + 1];
      return Math.hypot(P[b][0] - P[a][0], P[b][1] - P[a][1]);
    };
    function drive() { schedule(atNode, segLen(i) / speed * 1000); }
    function atNode() {
      i++;
      out({ t: 'node', ms: Math.round(now()) });
      const turn = plan.turns[i - 1];
      if (turn === 'STOP') { plan = null; return; }
      if (turn === 'S') drive();
      else schedule(() => { out({ t: 'turn', dir: turn, ms: Math.round(now()) }); drive(); }, RC.turnSec * 1000);
    }
    api.send = (m) => {
      if (m.cmd === 'speed') speed = m.cm_s / 100 / UNIT;
      if (m.cmd === 'plan') { clear(); stopped = false; plan = m; i = 0; }
      if (m.cmd === 'stop') {
        if (pending && !stopped) { remain = Math.max(0, due - now()); clearTimeout(timer); stopped = true; out({ t: 'pause', why: 'button' }); }
      }
      if (m.cmd === 'start') {
        if (!plan) return;
        if (stopped) { stopped = false; const fn = pending; schedule(fn, remain); out({ t: 'resume' }); return; }
        if (plan.pre !== 'S') schedule(() => { out({ t: 'turn', dir: plan.pre }); drive(); }, RC.turnSec * 1000);
        else { out({ t: 'go', ms: Math.round(now()) }); drive(); }
      }
    };
    return api;
  }

  let transport = null;
  function useTransport(t) {
    if (transport) transport.onmessage = null;
    transport = t;
    transport.onmessage = receive;
  }
  useTransport(SimTransport());

  setHome(CFG.robotLocation);

  return {
    config: RC,
    enabled: () => !!RC.enabled,
    setHome, planFor, escort, returnHome, pause, resume,
    pose, status, busy: () => !!run, isHome: () => !run && !!at && !!home && at.node === home.node,
    on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    useTransport, transport: () => transport,
    placeName,
    debug: { P, adj, shortest, toTurns },
  };
})();
