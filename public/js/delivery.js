/* 로봇 화면의 배달 기능 (robot.html)
 *
 * 흐름: 휴대폰 호출 → (로봇이 비어 있으면 자동으로) 호출 받기 → 부른 곳으로 이동
 *      → 도착: "제가 불렀어요" 또는 로봇 제어 프로그램의 도착 보고 → 물건 싣기 → 받는 곳 고르기
 *      → 받는 사람·메모 → 출발 → 받는 곳 도착 → "받았어요" → 제자리로
 *
 * 서버: /api/robot (X-Robot-Key). 이 기기의 키는 설정 링크 robot.html#key=... 로 한 번 저장한다.
 * 로봇 제어 프로그램(라인 트레이스)은 같은 API 로 목적지 계획(target.plan)을 받아 가고,
 * 노드를 지날 때 progress, 도착하면 arrived 를 보낸다 → 이 화면과 부른 사람 휴대폰에 실시간으로 보인다.
 */
window.KIS = window.KIS || {};

KIS.Delivery = (function () {
  const CFG = KIS.CONFIG, D = KIS.DATA, RT = KIS.Router, I = KIS.icon;
  const KEY_STORE = 'kis-robot-key', DEVICE_STORE = 'kis-robot-device';
  const $ = (s, r = document) => r.querySelector(s);
  let app = null, key = null, srv = null, skew = 0, pollT = null, busy = false, online = null;
  let last = { mode: undefined, callId: undefined };
  let liveMap = null, livePlan = null, liveT = null;
  const draft = { callId: null, step: 'load', dest: null, recipient: '', memo: '', sender: '' };

  /* ── 설정: robot.html#key=... 로 열면 이 기기를 로봇으로 등록 ── */
  function readKey() {
    try {
      const i = location.hash.indexOf('key=');
      if (i >= 0) {
        // 'key=' 뒤 전부가 키 (키에 & · % 같은 글자가 있어도 그대로)
        const raw = location.hash.slice(i + 4).trim();
        let k = raw;
        try { k = decodeURIComponent(raw); } catch (e) { /* % 가 들어간 키는 그대로 */ }
        if (k) {
          localStorage.setItem(KEY_STORE, k);
          localStorage.setItem(DEVICE_STORE, '1');
        }
        history.replaceState(null, '', location.pathname + location.search);
      }
      key = localStorage.getItem(KEY_STORE);
      if (key) localStorage.setItem(DEVICE_STORE, '1');
    } catch (e) { key = null; }
  }
  // 이미 열린 화면에서 주소 뒤에 #key=… 만 바꿔 열면 페이지가 다시 열리지 않으니, 새 키를 저장하고 다시 연다
  window.addEventListener('hashchange', () => {
    if (location.hash.indexOf('key=') < 0) return;
    readKey();
    location.reload();
  });

  async function api(method, path, body) {
    const res = await fetch(`/api/robot${path}`, {
      method, cache: 'no-store',
      headers: { 'content-type': 'application/json', 'x-robot-key': key },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || `서버 응답 ${res.status}`); e.status = res.status; throw e; }
    return data;
  }
  function take(data) {
    srv = data;
    skew = (data.now || Date.now()) - Date.now();
    onState();
  }
  async function act(action, body) {
    if (busy) return false;
    busy = true;
    try { take(await api('POST', `/${action}`, body || {})); return true; } catch (e) { app.bubble(e.message, false); return false; } finally { busy = false; }
  }
  async function poll() {
    clearTimeout(pollT);
    try { take(await api('GET', '')); online = true; } catch (e) { online = false; if (e.status === 401) app.bubble(key ? '이 기기에 저장된 로봇 키가 서버의 키와 달라요. 키를 확인해서 설정 링크(/robot#key=…)를 다시 열어 주세요.' : '이 기기에 로봇 키가 없어요. 설정 링크(/robot#key=…)를 열어 주세요.', false); }
    const busyMode = srv && srv.robot && srv.robot.mode !== 'idle';
    pollT = setTimeout(poll, busyMode ? 2000 : 3000);
  }

  /* ── 장소·위치 도우미 ── */
  const roomName = (id) => { const r = D.roomById(id); return r ? RT.displayName(r) : (id || ''); };
  const label = (id, lbl) => lbl || roomName(id);
  const honor = (n) => (/님$/.test(n) ? n : `${n}님`); // '보건 선생님' → 그대로, '김민지' → '김민지님'
  const home = () => app.state.location;
  const now = () => Date.now() + skew;
  function currentPos() {
    const r = srv && srv.robot;
    const loc = r && r.target && r.target.plan && r.progress ? RT.locate(r.target.plan, r.progress, now()) : null;
    if (loc) return { floor: loc.floor, x: loc.x, y: loc.y };
    const p = (r && r.position) || home();
    return { floor: p.floor, x: p.x, y: p.y, label: p.label };
  }
  function targetFor(roomId, lbl) {
    const room = D.roomById(roomId);
    if (!room) return null;
    const plan = RT.robotPlan(currentPos(), room);
    const end = plan ? plan.nodes[plan.nodes.length - 1] : { floor: room.floor, x: RT.roomCenter(room)[0], y: RT.roomCenter(room)[1] };
    return { room: room.id, label: lbl || RT.displayName(room), floor: end.floor, x: end.x, y: end.y, plan };
  }

  /* ── 상태가 바뀔 때 ── */
  function onState() {
    const m = srv.robot.mode, cid = srv.call ? srv.call.id : null;
    if (m !== last.mode || cid !== last.callId) {
      const prev = last.mode;
      last = { mode: m, callId: cid };
      modeChanged(prev, m);
    }
    if (m === 'returning' && !srv.robot.target) setReturnTarget();
    if (m === 'returning') maybeHome();
    maybeAccept();
    // 엘리베이터 앞에 멈추면 주변 사람에게 도움을 부탁한다 (로봇 몸체가 버튼이나 이 화면의 버튼을 기다림)
    const ev = elevatorWait();
    const evKey = ev ? `${srv.robot.progress.passed}@${srv.robot.progress.at}` : null;
    if (ev && evKey !== last.elevator) {
      last.elevator = evKey;
      const msg = `엘리베이터에 태워 주세요! ${ev.toFloor}층에서 내려 주시고, 화면의 버튼을 눌러 주세요`;
      if (app.isFace()) app.caption(msg, 8000);
      app.say(`엘리베이터에 태워 주세요. ${ev.toFloor}층에서 내려 주세요.`);
      if (app.state.current && app.state.current.view === 'mission' && !app.isFace()) app.render();
    }
    if (!ev && last.elevator) { last.elevator = null; if (app.state.current && app.state.current.view === 'mission' && !app.isFace()) app.render(); }
    if (app.state.current && ['mission', 'delivery', 'receive'].includes(app.state.current.view) && !app.isFace()) refreshView();
  }

  function modeChanged(prev, m) {
    const c = srv.call;
    const first = prev === undefined;
    if (c && draft.callId !== c.id) Object.assign(draft, { callId: c.id, step: 'load', dest: null, recipient: '', memo: '', sender: c.caller || '' });
    if (m === 'to_caller' && !first) {
      app.sleep();
      app.faces.big.react('happy', 1500);
      const where = label(c.from_room, c.from_label);
      app.caption(`호출을 받았어요! ${RT.josa(where, '으로/로')} 갈게요`, 6000);
      app.say(`호출을 받았어요! ${RT.josa(where, '으로/로')} 갈게요.`);
    } else if (m === 'loading') {
      app.showApp();
      app.go('delivery', {}, { push: false });
      if (!first) app.say('도착했어요! 보낼 물건을 로봇에 넣어 주세요.');
      app.bubble('보낼 물건을 로봇에 넣어 주세요!', false);
    } else if (m === 'delivering' && !first) {
      app.sleep();
      const where = label(c.to_room, c.to_label);
      app.caption(`${RT.josa(where, '으로/로')} 배달 가는 중이에요`, 6000);
      app.say(`${RT.josa(where, '으로/로')} 배달하러 출발할게요!`);
    } else if (m === 'at_recipient') {
      app.showApp();
      app.go('receive', {}, { push: false });
      app.bubble('배달 왔어요! 물건을 꺼내 가세요.', false);
      if (!first) app.say(`배달 왔어요! ${c.recipient ? `${honor(c.recipient)}, ` : ''}물건을 꺼내 가세요.`);
    } else if (m === 'returning' && !first) {
      app.sleep();
      app.caption(['guiding', 'guided'].includes(prev) ? '안내를 마쳤어요. 제자리로 돌아갈게요' : '배달을 마쳤어요. 제자리로 돌아갈게요', 5000);
    }
    listeners.forEach((fn) => fn(prev, m));
  }
  const listeners = [];

  // 사람이 로봇 화면을 쓰고 있지 않을 때만 다음 호출을 받는다
  function maybeAccept() {
    if (!srv || busy || !srv.queue || !srv.queue.length) return;
    if (!['idle', 'returning'].includes(srv.robot.mode)) return;
    if (!app.isFace() && app.idleFor() < 20000) return;
    const c = srv.queue[0];
    act('accept', { id: c.id, target: targetFor(c.from_room, c.from_label) });
  }
  function setReturnTarget() {
    if (busy) return;
    const h = home();
    const plan = RT.robotPlanToPoint(currentPos(), h);
    act('target', { target: { room: null, label: h.label || '제자리', floor: h.floor, x: h.x, y: h.y, plan } });
  }
  // 주행 보고가 없는(아직 로봇 몸체가 연결되지 않은) 경우: 예상 시간이 지나면 제자리에 도착한 것으로 본다
  function maybeHome() {
    const r = srv.robot;
    if (!r.target || r.progress || busy) return;
    const total = r.target.plan ? r.target.plan.total_m : 0;
    const wait = (total / (CFG.robotSpeed || 0.5)) * 1000 + 10000;
    if (now() - (r.updatedAt || now()) > wait) act('arrived', {});
  }

  /* ── 화면 ── */
  const mode = () => (srv ? srv.robot.mode : 'idle');
  const call = () => (srv ? srv.call : null);
  const badge = (roomId) => {
    const r = D.roomById(roomId);
    return r ? `<span class="dest-badge cat-${r.cat}"><b>${r.floor}</b>층</span>` : '';
  };
  const steps = (cur) => `<ol class="dl-steps">${['물건 싣기', '받는 곳', '받는 사람·메모', '출발'].map((t, i) => `<li class="${i < cur ? 'is-done' : i === cur ? 'is-on' : ''}"><b>${i + 1}</b>${t}</li>`).join('')}</ol>`;

  function missionView() {
    const m = mode(), c = call(), esc = app.esc;
    let title = '', sub = '', main = '', rows = '';
    if (m === 'to_caller' && c) {
      title = '부른 곳으로 가고 있어요';
      main = `${badge(c.from_room)}<b>${esc(label(c.from_room, c.from_label))}</b>`;
      rows = `${c.caller ? `<p>${I('phone')}부른 사람 <b>${esc(c.caller)}</b></p>` : ''}${c.caller_note ? `<p>${I('chat')}보낼 물건 <b>${esc(c.caller_note)}</b></p>` : ''}`;
      sub = `<button class="btn btn-primary dl-big" data-action="dl-arrived">${I('hand')}제가 불렀어요 · 물건 싣기</button>`;
    } else if (m === 'delivering' && c) {
      title = '배달 가는 중이에요';
      main = `${badge(c.to_room)}<b>${esc(label(c.to_room, c.to_label))}</b>`;
      rows = `${c.recipient ? `<p>${I('arrive')}받는 사람 <b>${esc(c.recipient)}</b></p>` : ''}${c.memo ? `<p>${I('chat')}메모 <b>${esc(c.memo)}</b></p>` : ''}`;
      sub = `<button class="btn btn-primary dl-big" data-action="dl-arrived">${I('hand')}제가 받는 사람이에요</button>`;
    } else if (m === 'returning') {
      title = '제자리로 돌아가고 있어요';
      main = `<b>${esc(home().label || '제자리')}</b>`;
      sub = `<button class="btn dl-big" data-action="dl-arrived">${I('home')}제자리에 도착했어요</button>`;
    } else {
      return `<section class="view">${app.viewHead('배달')}<div class="empty"><h2>지금 하는 배달이 없어요</h2></div></section>`;
    }
    const ev = elevatorWait();
    if (ev) {
      title = `엘리베이터에 태워 주세요 (${ev.toFloor}층)`;
      sub = `<button class="btn btn-primary dl-big" data-action="dl-elevator-out">${I('elevator')}${ev.toFloor}층에서 내렸어요 · 다시 출발</button>`;
    }
    return `<section class="view view-dl dl-mission">
      <div class="card dl-map-card"><div class="map-host" id="dl-map"></div><p class="dl-live" id="dl-live"></p></div>
      <aside class="card dl-panel">
        <p class="dl-kicker">${I('box')}피콕 배달</p>
        <h1>${title}</h1>
        <div class="dl-place">${main}</div>
        <div class="dl-rows">${rows}</div>
        <div class="dl-actions">${sub}
          <button class="btn" data-action="dl-menu">${I('map')}길 안내 메뉴</button>
          ${m !== 'returning' ? `<button class="dl-link" data-action="dl-cancel">배달 취소</button>` : ''}
        </div>
      </aside>
    </section>`;
  }

  function deliveryView() {
    const c = call(), esc = app.esc;
    if (mode() !== 'loading' || !c) return missionView();
    if (draft.step === 'load' || !draft.dest) {
      return `<section class="view view-dl dl-load">
        ${steps(0)}
        <div class="card dl-hero">
          <div class="dl-box">${I('box')}</div>
          <div class="dl-hero-text">
            <h1>보낼 물건을 로봇 안에 넣어 주세요</h1>
            <p>${c.kind === 'call' ? `${esc(label(c.from_room, c.from_label))}에서 ${c.caller ? `<b>${esc(c.caller)}</b>님이 ` : ''}불렀어요${c.caller_note ? ` · ${esc(c.caller_note)}` : ''}` : '로봇 앞에서 바로 보내는 배달이에요'}</p>
            <div class="dl-actions dl-row">
              <button class="btn btn-primary dl-big" data-action="dl-next">${I('arrive')}다 넣었어요 · 받는 곳 고르기</button>
              <button class="dl-link" data-action="dl-cancel">배달 취소</button>
            </div>
          </div>
        </div>
      </section>`;
    }
    const dest = D.roomById(draft.dest);
    const plan = RT.robotPlan(currentPos(), dest);
    const chips = ['담임 선생님', '보건 선생님', '행정실', '교무실 선생님', '도서실 선생님'];
    return `<section class="view view-dl dl-info">
      ${steps(2)}
      <div class="card dl-form">
        <div class="dl-field dl-field-dest">
          <span class="dl-label">받는 곳</span>
          <div class="dl-value">${badge(dest.id)}<b>${esc(RT.displayName(dest))}</b>${plan ? `<small>로봇 길 약 ${RT.fmtMeters(plan.total_m)}${plan.nodes.some((n) => n.action === 'elevator') ? ' · 엘리베이터 이용' : ''}</small>` : '<small class="dl-warn">로봇이 갈 수 없는 곳이에요 (엘리베이터로 못 감)</small>'}</div>
          <button class="btn" data-action="dl-pick">바꾸기</button>
        </div>
        <div class="dl-field">
          <span class="dl-label">받는 사람</span>
          <button class="dl-input ${draft.recipient ? '' : 'is-empty'}" data-action="dl-recipient">${esc(draft.recipient || '누구에게 줄까요? (눌러서 쓰기)')}</button>
        </div>
        <div class="dl-chips">${chips.map((t) => `<button class="chip" data-action="dl-chip" data-id="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <div class="dl-field">
          <span class="dl-label">메모</span>
          <button class="dl-input ${draft.memo ? '' : 'is-empty'}" data-action="dl-memo">${esc(draft.memo || '전할 말을 남겨 주세요 (선택)')}</button>
        </div>
        <div class="dl-field">
          <span class="dl-label">보내는 사람</span>
          <button class="dl-input ${draft.sender ? '' : 'is-empty'}" data-action="dl-sender">${esc(draft.sender || '이름 (선택)')}</button>
        </div>
        <div class="dl-actions dl-row">
          <button class="btn btn-primary dl-big" data-action="dl-depart" ${plan ? '' : 'disabled'}>${I('straight')}출발하기</button>
          <button class="dl-link" data-action="dl-cancel">배달 취소</button>
        </div>
      </div>
    </section>`;
  }

  function receiveView() {
    const c = call(), esc = app.esc;
    if (mode() !== 'at_recipient' || !c) return missionView();
    return `<section class="view view-dl dl-receive">
      <div class="card dl-letter">
        <p class="dl-kicker">${I('box')}배달 왔어요!</p>
        <h1>${c.recipient ? `<b>${esc(honor(c.recipient))}</b>께` : `${esc(label(c.to_room, c.to_label))}에`} 온 물건이에요</h1>
        ${c.memo ? `<blockquote class="dl-memo">“${esc(c.memo)}”</blockquote>` : ''}
        <p class="dl-from">${I('start')}보낸 곳 <b>${esc(label(c.from_room, c.from_label))}</b>${c.caller ? ` · 보낸 사람 <b>${esc(c.caller)}</b>` : ''}</p>
        <div class="dl-actions dl-row">
          <button class="btn btn-primary dl-big" data-action="dl-received">${I('arrive')}물건을 꺼냈어요</button>
        </div>
      </div>
    </section>`;
  }

  /* 배달 지도: 로봇 경로(노드)와 실시간 위치 */
  function drawPlan(mv, plan, floor) {
    const pts = plan.nodes.filter((n) => n.floor === floor);
    if (pts.length < 1) return;
    const elev = pts.find((n) => n.action === 'elevator');
    const seg = { floor, draw: pts.map((n) => [n.x, n.y]), via: elev ? { type: 'elev', x: elev.x, y: elev.y, toFloor: elev.toFloor } : null };
    const startHere = plan.nodes[0].floor === floor;
    const room = plan.to && plan.to.room ? D.roomById(plan.to.room) : null;
    const prevFloor = startHere ? null : (plan.nodes.find((n, i) => plan.nodes[i + 1] && plan.nodes[i + 1].floor === floor && n.floor !== floor) || {}).floor;
    if (seg.draw.length === 1) seg.draw.push(seg.draw[0]);
    mv.showRoute(seg, { isFirst: startHere, prevFloor, room, youLabel: '출발' });
  }
  function mountMap() {
    const host = $('#dl-map');
    if (!host || !srv || !srv.robot.target) { liveMap = null; return; }
    const plan = srv.robot.target.plan;
    livePlan = plan;
    liveMap = new KIS.MapView(host, {});
    const loc = plan && srv.robot.progress ? RT.locate(plan, srv.robot.progress, now()) : null;
    const floor = loc ? loc.floor : plan ? plan.nodes[0].floor : srv.robot.target.floor;
    liveMap.setFloor(floor);
    if (plan) drawPlan(liveMap, plan, floor);
    liveMap.floorShown = floor;
    tickLive();
    clearInterval(liveT);
    liveT = setInterval(tickLive, 500);
  }
  function tickLive() {
    const host = $('#dl-map');
    if (!host || !liveMap) { clearInterval(liveT); return; }
    const r = srv && srv.robot;
    const info = $('#dl-live');
    const loc = r && r.target && r.target.plan && r.progress ? RT.locate(r.target.plan, r.progress, now()) : null;
    if (!loc) {
      liveMap.hideRobot();
      if (info) info.textContent = r && r.bodyOnline ? '로봇 몸체 연결됨 · 출발을 기다리는 중' : '로봇 몸체(ESP8266)가 연결되면 지도에서 실시간 위치가 보여요';
      return;
    }
    if (loc.floor !== liveMap.floorShown) { mountMap(); return; }
    liveMap.robotDot(loc.x, loc.y);
    const ev = elevatorWait();
    if (info) info.textContent = ev ? `엘리베이터 앞에서 기다리는 중 — ${ev.toFloor}층으로 태워 주세요` : `${nodeName(loc.at)} 지나는 중${loc.next ? ` → ${nodeName(loc.next)}` : ''}`;
  }
  // 로봇이 엘리베이터 노드에 멈춰 사람의 도움을 기다리는 중이면 { toFloor, exit, after }
  function elevatorWait() {
    const r = srv && srv.robot;
    const plan = r && r.target && r.target.plan;
    if (!plan || !r.progress) return null;
    const i = plan.nodes.findIndex((n) => n.key === r.progress.passed);
    const n = plan.nodes[i];
    if (!n || n.action !== 'elevator') return null;
    const exit = plan.nodes[i + 1], after = plan.nodes[i + 2];
    return exit ? { toFloor: n.toFloor, exit: exit.key, after: after ? after.key : null } : null;
  }
  function nodeName(k) {
    if (!k) return '';
    if (k === 'START') return '출발점';
    if (k === 'END') return '도착점';
    const [f, id] = k.split(':');
    const n = D.floorById(f) && D.floorById(f).nodes[id];
    const lm = n ? RT.landmark(Number(f), [n[0], n[1]], 30) : null;
    return lm ? `${f}층 ${RT.displayName(lm)} 앞` : `${f}층 ${id}`;
  }
  function refreshView() {
    const v = app.state.current.view;
    const want = mode() === 'loading' ? 'delivery' : mode() === 'at_recipient' ? 'receive' : ['to_caller', 'delivering', 'returning'].includes(mode()) ? 'mission' : null;
    if (want && v !== want && v !== 'mission') app.go(want, {}, { push: false });
    else if (!want && v !== 'mission') app.goHome();
    else if (v === 'mission' && liveMap && srv.robot.target && srv.robot.target.plan !== livePlan && JSON.stringify(srv.robot.target.plan) !== JSON.stringify(livePlan)) app.render();
  }

  /* ── 버튼 ── */
  function typeField(field, title, chips, max) {
    app.keyboard.open({
      title, initial: draft[field], max, chips,
      tip: '다 쓰면 완료를 눌러 주세요',
      onDone: (t) => { draft[field] = t; app.render(); },
    });
  }
  function onAction(a, id) {
    const c = call();
    switch (a) {
      case 'dl-walkup': {
        const h = home();
        const lm = RT.landmark(h.floor, [h.x, h.y], 60);
        act('walkup', { from_room: lm ? lm.id : 'f1-현관', from_label: h.label });
        break;
      }
      case 'dl-arrived': act('arrived', {}); break;
      case 'dl-elevator-out': {
        // 로봇 몸체(ESP8266)는 '지난 노드'가 엘리베이터 출구로 바뀌면 이어서 출발한다
        const ev = elevatorWait();
        if (ev) act('progress', { passed: ev.exit, next: ev.after, speed: srv.robot.progress && srv.robot.progress.speed });
        break;
      }
      case 'dl-next':
      case 'dl-pick':
        draft.step = 'dest';
        app.state.pick = (roomId) => {
          draft.dest = roomId; draft.step = 'info';
          app.go('delivery', {}, { push: false });
          app.bubble('받는 사람과 메모를 적어 주세요.', false);
        };
        app.goHome();
        app.bubble('어디로 보낼까요? 받는 곳을 골라 주세요.', true);
        break;
      case 'dl-pick-cancel':
        app.state.pick = null;
        app.go('delivery', {}, { push: false });
        break;
      case 'dl-recipient': typeField('recipient', '받는 사람 (예: 김민지 선생님)', ['선생님', '님'], 30); break;
      case 'dl-memo': typeField('memo', '메모 (예: 수업 자료예요)', ['급해요', '조심히 다뤄 주세요', '서류예요', '감사합니다'], 120); break;
      case 'dl-sender': typeField('sender', '보내는 사람 이름', [], 30); break;
      case 'dl-chip': draft.recipient = id; app.render(); break;
      case 'dl-depart': {
        if (!c || !draft.dest) break;
        const t = targetFor(draft.dest);
        if (!t || !t.plan) { app.bubble('로봇이 갈 수 없는 곳이에요. 다른 곳을 골라 주세요.', false); break; }
        act('depart', { to_room: draft.dest, to_label: t.label, recipient: draft.recipient, memo: draft.memo, caller: draft.sender, target: t });
        break;
      }
      case 'dl-received': act('delivered', {}).then((ok) => { if (ok) app.say('고마워요! 제자리로 돌아갈게요.'); }); break;
      case 'dl-cancel':
        if (window.confirm('이 배달을 취소할까요?')) act('cancel', {}).then((ok) => { if (ok) app.bubble('배달을 취소했어요.', false); });
        break;
      case 'dl-menu':
        app.goHome();
        app.bubble('길 안내도 해 드릴게요. 배달은 계속하고 있어요.', false);
        break;
      default: break;
    }
  }

  function init(theApp) {
    app = theApp;
    readKey();
    const h = app.hooks;
    app.views.mission = missionView;
    app.views.delivery = deliveryView;
    app.views.receive = receiveView;
    h.onRender = (view) => {
      clearInterval(liveT);
      if (view === 'mission') mountMap();
      if (app.state.pick && view !== 'delivery') {
        const sec = $('#view > section');
        if (sec) sec.insertAdjacentHTML('afterbegin', `<div class="pick-banner">${I('box')}<span><b>배달 받는 곳을 골라 주세요</b> 교실·장소를 누르면 그곳으로 보내요</span><button class="btn" data-action="dl-pick-cancel">돌아가기</button></div>`);
      }
    };
    h.onAction = onAction;
    if (!key) return;
    h.onWake = () => {
      const m = mode();
      if (m === 'idle') return false;
      app.showApp();
      app.go(m === 'loading' ? 'delivery' : m === 'at_recipient' ? 'receive' : 'mission', {}, { push: false });
      app.bubble(h.missionLine() || '배달 중이에요', false);
      return true;
    };
    h.onHome = () => {
      // 물건을 싣는 중·받는 곳 도착 상태에서는 '처음으로'가 배달 화면(또는 받는 곳 고르기 처음)으로 간다
      if (mode() === 'loading' && app.state.pick) { app.goHome(); return true; }
      if (['loading', 'at_recipient'].includes(mode())) {
        app.go(mode() === 'loading' ? 'delivery' : 'receive', {}, { push: false });
        return true;
      }
      return false;
    };
    h.missionLine = () => {
      const m = mode(), c = call();
      const ev = elevatorWait();
      if (ev) return `엘리베이터에 태워 주세요! ${ev.toFloor}층에서 내려 주시고, 화면을 눌러 주세요`;
      if (m === 'to_caller' && c) return `${label(c.from_room, c.from_label)}에서 불러서 가고 있어요`;
      if (m === 'loading') return '보낼 물건을 넣어 주세요! 화면을 눌러 주세요';
      if (m === 'delivering' && c) return `${RT.josa(label(c.to_room, c.to_label), '으로/로')} 배달 가는 중이에요`;
      if (m === 'at_recipient') return '배달 왔어요! 화면을 눌러 주세요';
      if (m === 'returning') return '제자리로 돌아가고 있어요';
      return null;
    };
    h.homeExtra = () => (['idle', 'returning'].includes(mode()) ? `<button class="deliver-btn" data-action="dl-walkup">${I('box')}<span>배달 보내기</span></button>` : '');
    h.adminExtra = () => `<div class="admin-dl"><b>배달 연결</b><span class="${online ? 'is-ok' : 'is-bad'}">${online ? '연결됨' : online === false ? '연결 안 됨' : '확인 중'}</span>
      <b>로봇 몸체(ESP8266)</b><span class="${srv && srv.robot.bodyOnline ? 'is-ok' : 'is-bad'}">${srv && srv.robot.bodyOnline ? '연결됨' : '연결 안 됨'}</span>
      <small>로봇 상태: ${mode()}${srv && srv.queue ? ` · 기다리는 호출 ${srv.queue.length}건` : ''}</small>
      <button class="btn" data-adm="dl-reset">${I('refresh')}배달 초기화</button></div>`;
    h.onAdmin = (a) => {
      if (a !== 'dl-reset') return false;
      if (window.confirm('지금 배달을 취소하고 로봇을 대기 상태로 되돌릴까요?')) act('reset', {});
      return true;
    };
    poll();
  }

  // 데려다주기(js/guide.js)도 같은 로봇 상태·주행 계획을 쓴다
  return {
    init, enabled: () => !!key, state: () => srv, act, currentPos, now, onMode: (fn) => listeners.push(fn),
    drawPlan, nodeName, elevatorWait,
  };
})();
