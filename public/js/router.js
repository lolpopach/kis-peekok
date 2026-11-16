/* 길 찾기: 복도 그래프 + 다익스트라 + 말로 하는 길 안내 문장 만들기 */
window.KIS = window.KIS || {};

KIS.Router = (function () {
  const D = KIS.DATA;
  const CFG = KIS.CONFIG;
  const STAIR_COST = 45;       // 계단 한 층 (도면 단위로 환산한 비용)
  const ELEV_COST = 8;         // 엘리베이터 한 층
  const ELEV_WAIT = 30;        // 엘리베이터 타고 내릴 때 대기 비용 (타기+내리기)

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  /* ── 그래프 ── */
  const nodes = {};       // key -> {key, floor, id, x, y, type, group}
  const floorEdges = {};  // floor -> [[keyA, keyB], …]
  floorsInit();

  function floorsInit() {
    D.floors.forEach((f) => {
      Object.entries(f.nodes).forEach(([id, v]) => {
        const key = `${f.id}:${id}`;
        nodes[key] = { key, floor: f.id, id, x: v[0], y: v[1], type: v[2] || 'hall', group: v[3] || null };
      });
      floorEdges[f.id] = f.edges.trim().split(/\s+/).map((pair) => {
        const [a, b] = pair.split('-');
        const ka = `${f.id}:${a}`, kb = `${f.id}:${b}`;
        if (!nodes[ka] || !nodes[kb]) console.warn('[data] 없는 노드:', pair, '층', f.id);
        return [ka, kb];
      });
    });
  }

  function buildAdjacency(mode) {
    const adj = {};
    const add = (a, b, w, kind) => {
      (adj[a] = adj[a] || []).push({ to: b, w, kind });
      (adj[b] = adj[b] || []).push({ to: a, w, kind });
    };
    Object.values(floorEdges).forEach((list) => list.forEach(([a, b]) => {
      const na = nodes[a], nb = nodes[b];
      if (!na || !nb) return;
      let w = dist([na.x, na.y], [nb.x, nb.y]);
      if (na.type === 'elev' || nb.type === 'elev') w += ELEV_WAIT / 2;
      add(a, b, w, 'walk');
    }));
    // 층 사이 연결 (같은 그룹의 계단·엘리베이터)
    const groups = {};
    Object.values(nodes).forEach((n) => {
      if (n.type === 'stair' || n.type === 'elev') (groups[n.group] = groups[n.group] || []).push(n);
    });
    Object.values(groups).forEach((list) => {
      list.sort((a, b) => a.floor - b.floor);
      for (let i = 0; i < list.length - 1; i++) {
        const a = list[i], b = list[i + 1];
        if (b.floor - a.floor !== 1) continue;
        if (a.type === 'elev') {
          if (mode === 'stairs') continue;
          add(a.key, b.key, ELEV_COST, 'elev');
        } else {
          if (mode === 'elevator') continue;
          add(a.key, b.key, STAIR_COST, 'stair');
        }
      }
    });
    return adj;
  }

  /* ── 방 ↔ 복도 연결 (출입문) ── */
  function rectDist(p, r) {
    const dx = Math.max(r[0] - p[0], 0, p[0] - r[2]);
    const dy = Math.max(r[1] - p[1], 0, p[1] - r[3]);
    return Math.hypot(dx, dy);
  }
  const roomDist = (p, room) => Math.min(...room.rects.map((r) => rectDist(p, r)));
  const roomCenter = (room) => {
    if (room.labelAt) return room.labelAt;
    const r = room.rect;
    return [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
  };

  function projectOnSeg(p, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const len2 = vx * vx + vy * vy || 1;
    let t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2;
    t = Math.max(0, Math.min(1, t));
    return { t, pt: [a[0] + vx * t, a[1] + vy * t] };
  }

  // 복도(계단·엘리베이터로 이어지는 짧은 선 제외) 위에서 가장 가까운 점
  function corridorEdges(floor) {
    return floorEdges[floor].filter(([a, b]) => nodes[a] && nodes[b] && nodes[a].type === 'hall' && nodes[b].type === 'hall');
  }

  function attachPoint(floor, p, room) {
    let best = null;
    corridorEdges(floor).forEach(([ka, kb]) => {
      const a = [nodes[ka].x, nodes[ka].y], b = [nodes[kb].x, nodes[kb].y];
      const { t, pt } = projectOnSeg(p, a, b);
      const d = room ? roomDist(pt, room) : dist(pt, p);
      const tie = dist(pt, p);
      if (!best || d < best.d - 0.01 || (Math.abs(d - best.d) <= 0.01 && tie < best.tie)) {
        best = { d, tie, a: ka, b: kb, t, pt };
      }
    });
    return best;
  }

  const doorCache = {};
  function roomDoors(room) {
    if (doorCache[room.id]) return doorCache[room.id];
    const pts = room.doors || [roomCenter(room)];
    const doors = pts.map((p) => {
      const at = attachPoint(room.floor, p, room.doors ? null : room);
      // 방 테두리 위의 문 위치 (지도에 그릴 때 사용)
      const r = room.rects.reduce((best, rc) => (rectDist(at.pt, rc) < rectDist(at.pt, best) ? rc : best), room.rects[0]);
      const edge = [Math.max(r[0], Math.min(r[2], at.pt[0])), Math.max(r[1], Math.min(r[3], at.pt[1]))];
      return Object.assign(at, { doorPt: edge });
    });
    doorCache[room.id] = doors;
    return doors;
  }

  /* ── 다익스트라 ── */
  function shortest(adj, start, goal) {
    const distTo = { [start]: 0 }, prev = {}, done = new Set();
    const queue = [[0, start]];
    while (queue.length) {
      let bi = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i][0] < queue[bi][0]) bi = i;
      const [d, u] = queue.splice(bi, 1)[0];
      if (done.has(u)) continue;
      done.add(u);
      if (u === goal) break;
      (adj[u] || []).forEach((e) => {
        const nd = d + e.w;
        if (distTo[e.to] === undefined || nd < distTo[e.to]) {
          distTo[e.to] = nd; prev[e.to] = { from: u, kind: e.kind };
          queue.push([nd, e.to]);
        }
      });
    }
    if (distTo[goal] === undefined) return null;
    const path = [goal];
    while (path[0] !== start) path.unshift(prev[path[0]].from);
    return { cost: distTo[goal], path };
  }

  function withTemp(adj) {
    const copy = {};
    Object.keys(adj).forEach((k) => { copy[k] = adj[k].slice(); });
    return copy;
  }

  function insertTemp(adj, key, at, floor) {
    const na = nodes[at.a], nb = nodes[at.b];
    nodes[key] = { key, floor, id: key, x: at.pt[0], y: at.pt[1], type: 'temp' };
    const wa = dist(at.pt, [na.x, na.y]), wb = dist(at.pt, [nb.x, nb.y]);
    const link = (x, y, w) => { (adj[x] = adj[x] || []).push({ to: y, w, kind: 'walk' }); };
    link(key, at.a, wa); link(at.a, key, wa); link(key, at.b, wb); link(at.b, key, wb);
  }

  /* ── 공개 함수: 경로 ── */
  function route(from, room, opts = {}) {
    const mode = opts.mode || 'stairs';
    let result = routeMode(from, room, mode);
    let fallback = false;
    if (!result && mode !== 'any') { result = routeMode(from, room, 'any'); fallback = !!result; }
    if (!result) return null;
    result.mode = mode;
    result.fallback = fallback;
    return result;
  }

  function routeMode(from, room, mode) {
    const adj = withTemp(buildAdjacency(mode));
    const startAt = attachPoint(from.floor, [from.x, from.y], null);
    insertTemp(adj, '__S', startAt, from.floor);
    const doors = roomDoors(room);
    doors.forEach((door, i) => {
      insertTemp(adj, `__D${i}`, door, room.floor);
      (adj[`__D${i}`] = adj[`__D${i}`] || []).push({ to: '__T', w: 0, kind: 'door' });
      // 출발점과 같은 복도 선 위에 있으면 바로 연결
      if ((door.a === startAt.a && door.b === startAt.b) || (door.a === startAt.b && door.b === startAt.a)) {
        const w = dist(door.pt, startAt.pt);
        adj.__S.push({ to: `__D${i}`, w, kind: 'walk' });
        adj[`__D${i}`].push({ to: '__S', w, kind: 'walk' });
      }
    });
    nodes.__T = { key: '__T', floor: room.floor, type: 'temp' };
    const sp = shortest(adj, '__S', '__T');
    if (!sp) return null;
    const keys = sp.path.slice(0, -1);
    const doorIdx = Number(keys[keys.length - 1].slice(3));
    const door = doors[doorIdx];
    const pts = keys.map((k) => {
      const n = nodes[k];
      return { x: n.x, y: n.y, floor: n.floor, type: n.type, group: n.group, key: k };
    });
    pts[0].type = 'start';
    pts[0].fromPt = [from.x, from.y];
    return buildRoute(pts, room, door, from, sp.cost);
  }

  /* 경로를 층별 구간으로 나누고 안내 문장을 만든다 */
  function buildRoute(pts, room, door, from) {
    let segments = [];
    pts.forEach((p) => {
      let seg = segments[segments.length - 1];
      if (!seg || seg.floor !== p.floor) {
        seg = { floor: p.floor, points: [] };
        segments.push(seg);
      }
      seg.points.push(p);
    });
    // 계단·엘리베이터로 그냥 지나치는 중간 층은 합친다 (1층 → 3층)
    segments = segments.filter((seg, i) => i === 0 || i === segments.length - 1 ||
      !seg.points.every((p) => p.type === 'stair' || p.type === 'elev'));
    // 지도에 그릴 선 (출발점과 문까지 포함)
    segments.forEach((seg, i) => {
      seg.draw = seg.points.map((p) => [p.x, p.y]);
      if (i === 0) seg.draw.unshift([from.x, from.y]);
      if (i === segments.length - 1) seg.draw.push(door.doorPt);
      seg.via = null;
      if (i < segments.length - 1) {
        const last = seg.points[seg.points.length - 1];
        seg.via = { type: last.type, x: last.x, y: last.y, toFloor: segments[i + 1].floor, group: last.group };
      }
    });

    let walk = 0;
    segments.forEach((seg) => { for (let i = 1; i < seg.draw.length; i++) walk += dist(seg.draw[i - 1], seg.draw[i]); });
    const meters = walk * CFG.metersPerUnit;
    const floorsMoved = segments.reduce((s, seg, i) => (i ? s + Math.abs(seg.floor - segments[i - 1].floor) : s), 0);
    const usesElevator = segments.some((s) => s.via && s.via.type === 'elev');
    const seconds = meters / CFG.walkSpeed + floorsMoved * (usesElevator ? 25 : CFG.secondsPerFloor);

    const r = { room, door, segments, meters, seconds, floorsMoved, usesElevator, from };
    r.steps = makeSteps(r);
    return r;
  }

  /* ── 한국어 조사 ── */
  function lastSound(word) {
    const s = String(word).replace(/\s*[([][^)\]]*[)\]]\s*$/, '').trim();
    const ch = s[s.length - 1] || '';
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const j = (code - 0xac00) % 28;
      return { jong: j > 0, rieul: j === 8 };
    }
    const digit = { 0: [1, 0], 1: [1, 1], 2: [0, 0], 3: [1, 0], 4: [0, 0], 5: [0, 0], 6: [1, 0], 7: [1, 1], 8: [1, 1], 9: [0, 0] }[ch];
    if (digit) return { jong: !!digit[0], rieul: !!digit[1] };
    if (/[lmnLMN]/.test(ch)) return { jong: true, rieul: /[lL]/.test(ch) };
    return { jong: false, rieul: false };
  }
  function josa(word, pair) {
    const { jong, rieul } = lastSound(word);
    const [a, b] = pair.split('/');
    if (pair === '으로/로') return word + (jong && !rieul ? '으로' : '로');
    return word + (jong ? a : b);
  }

  /* ── 랜드마크 ── */
  const displayName = (room) => {
    if (room.cat === 'restroom') return '화장실';
    if (room.group === 'class' && room.grade > 0) return `${room.name}반`;
    return room.title || room.name;
  };
  function landmark(floor, p, maxD = 16, exclude) {
    const f = D.floorById(floor);
    let best = null;
    f.rooms.forEach((room) => {
      if (room.cat === 'neutral' || room === exclude) return;
      const d = roomDist(p, room);
      if (d <= maxD && (!best || d < best.d)) best = { d, room };
    });
    return best ? best.room : null;
  }
  function stairName(floor, p, type) {
    if (type === 'elev') return '엘리베이터';
    const lm = landmark(floor, p, 30);
    return lm ? `${displayName(lm)} 옆 계단` : '계단';
  }

  function fmtMeters(m) {
    if (m < 10) return `${Math.max(1, Math.round(m))}m`;
    return `${Math.round(m / 5) * 5}m`;
  }

  /* 직선 구간 단순화 (Douglas–Peucker) */
  function simplify(points, eps) {
    if (points.length < 3) return points.slice();
    const [a, b] = [points[0], points[points.length - 1]];
    let idx = -1, maxD = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const { pt } = projectOnSeg(points[i], a, b);
      const d = dist(points[i], pt);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD <= eps) return [a, b];
    const left = simplify(points.slice(0, idx + 1), eps);
    const right = simplify(points.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }

  function turnDir(a, b, c) {
    const h = [b[0] - a[0], b[1] - a[1]], t = [c[0] - b[0], c[1] - b[1]];
    const cross = h[0] * t[1] - h[1] * t[0];
    const dot = h[0] * t[0] + h[1] * t[1];
    const ang = Math.atan2(cross, dot) * 180 / Math.PI; // 화면 좌표: + 는 오른쪽
    if (Math.abs(ang) < 30) return 'straight';
    if (Math.abs(ang) > 150) return 'back';
    return ang > 0 ? 'right' : 'left';
  }

  function makeSteps(r) {
    const steps = [];
    const M = (a, b) => dist(a, b) * CFG.metersPerUnit;
    const dest = displayName(r.room);

    r.segments.forEach((seg, si) => {
      const isFirst = si === 0, isLast = si === r.segments.length - 1;
      // 안내용 꺾은선: 복도 위의 점만 사용
      let line = simplify(seg.points.map((p) => [p.x, p.y]), 12);
      // 계단·엘리베이터 바로 앞뒤의 짧은 꺾임은 따로 말하지 않는다
      if (!isLast && line.length > 2 && dist(line[line.length - 2], line[line.length - 1]) < 30) line.pop();
      if (!isFirst && line.length > 2 && dist(line[0], line[1]) < 30) line.shift();
      // 아주 짧은 구간 정리
      for (let i = line.length - 2; i > 0; i--) {
        if (dist(line[i], line[i + 1]) < 8 && i + 1 < line.length - 1) line.splice(i + 1, 1);
      }

      if (isFirst) {
        steps.push({ icon: 'start', floor: seg.floor, at: [r.from.x, r.from.y], text: `현재 위치(${r.from.label || `${seg.floor}층`})에서 출발해요` });
      } else {
        const prev = r.segments[si - 1];
        steps.push({
          icon: prev.via.type === 'elev' ? 'elevator' : (seg.floor > prev.floor ? 'stairs-up' : 'stairs-down'),
          floor: prev.floor, at: [prev.via.x, prev.via.y],
          text: `${josa(stairName(prev.floor, [prev.via.x, prev.via.y], prev.via.type), '으로/로')} ${seg.floor}층까지 ${prev.via.type === 'elev' ? '이동해요' : (seg.floor > prev.floor ? '올라가요' : '내려가요')}`,
          floorChange: true,
        });
      }

      if (line.length >= 2) {
        const len = M(line[0], line[1]);
        const lm = landmark(seg.floor, line[1], 16, r.room);
        if (line.length === 2 && isLast) {
          if (len >= 3) steps.push({ icon: 'straight', floor: seg.floor, at: line[1], text: `${!isFirst ? `${seg.floor}층 복도에서 ` : ''}${josa(dest, '을/를')} 향해 약 ${fmtMeters(len)} 걸어가요` });
        } else if (len >= 3) {
          const prefix = !isFirst ? `${seg.floor}층에 도착하면 ` : '';
          steps.push({ icon: 'straight', floor: seg.floor, at: line[1], text: `${prefix}${lm ? `${displayName(lm)} 앞까지` : '복도를 따라'} 약 ${fmtMeters(len)} 걸어가요` });
        }
        for (let i = 1; i < line.length - 1; i++) {
          const dir = turnDir(line[i - 1], line[i], line[i + 1]);
          if (dir === 'straight') continue;
          const next = line[i + 1];
          const lmTurn = landmark(seg.floor, line[i], 16, r.room);
          const where = lmTurn ? `${displayName(lmTurn)} 앞에서 ` : '';
          const len2 = M(line[i], next);
          const lmNext = landmark(seg.floor, next, 16, r.room);
          const toward = isLast && i === line.length - 2 ? '' : (lmNext ? ` ${displayName(lmNext)} 쪽으로` : '');
          const word = dir === 'left' ? '왼쪽' : dir === 'right' ? '오른쪽' : '뒤쪽';
          steps.push({ icon: dir === 'back' ? 'uturn' : dir, floor: seg.floor, at: line[i], text: `${where}${word}으로 돌아${toward} 약 ${fmtMeters(len2)} 가요` });
        }
      }

      if (isLast) {
        // 도착: 목적지가 진행 방향의 어느 쪽인지
        let side = '';
        if (line.length >= 2) {
          let a = line[line.length - 2], b = line[line.length - 1];
          if (dist(a, b) < 4 && line.length >= 3) a = line[line.length - 3];
          const c = r.door.doorPt;
          const h = [b[0] - a[0], b[1] - a[1]], t = [c[0] - b[0], c[1] - b[1]];
          if (Math.hypot(...t) > 0.5 && Math.hypot(...h) > 0.5) {
            const ang = Math.atan2(h[0] * t[1] - h[1] * t[0], h[0] * t[0] + h[1] * t[1]) * 180 / Math.PI;
            side = Math.abs(ang) < 35 ? '정면에' : ang > 0 ? '오른쪽에' : '왼쪽에';
          }
        }
        steps.push({ icon: 'arrive', floor: seg.floor, at: r.door.doorPt, text: `도착! ${josa(dest, '은/는')} ${side ? `${side} ` : ''}있어요` });
      }
    });
    return steps;
  }

  /* 가장 가까운 화장실·엘리베이터 등 */
  function nearest(from, predicate, opts) {
    let best = null;
    D.rooms().filter(predicate).forEach((room) => {
      const r = route(from, room, opts);
      if (r && (!best || r.seconds < best.seconds)) best = r;
    });
    return best;
  }

  return {
    route, nearest, josa, displayName, roomCenter, roomDoors, landmark, fmtMeters,
    debug: { nodes, floorEdges, attachPoint },
  };
})();
