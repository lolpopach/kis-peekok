/* 길 안내 방식 두 가지: 데려다주기 / QR 만 주기 (robot.html)
 *
 * 길 안내 화면 아래에서 고른다.
 *  - QR로 받을게요: 지금까지처럼 휴대폰용 길 안내 QR 코드 (app.js 의 QR)
 *  - 데려다주세요: 로봇이 앞장서서 목적지 문 앞까지 간다. 배달과 같은 로봇 상태·주행 계획을 쓴다.
 *      POST /api/robot/guide { to_room, to_label, target:{…, plan} }   idle|returning → guiding
 *      로봇 몸체가 END 에 닿아 arrived 를 보내면                         guiding → guided
 *      "고마워요"(또는 잠시 뒤 자동) → cancel                             guided → returning → (제자리) idle
 *    주행 계획은 Router.robotPlan (엘리베이터만, 모든 층), 위치는 Router.locate (노드 통과 보고 + 등속도).
 *    로봇 몸체가 아직 없으면 "다 왔어요" 버튼으로 도착을 대신 알린다.
 */
window.KIS = window.KIS || {};

KIS.Guide = (function () {
  const CFG = KIS.CONFIG, D = KIS.DATA, RT = KIS.Router, I = KIS.icon;
  const $ = (s, r = document) => r.querySelector(s);
  const GUIDE_MODES = ['guiding', 'guided'];
  const TURN = { left: '왼쪽', right: '오른쪽', uturn: '뒤쪽' };
  const speed = () => CFG.robotSpeed || 0.5;
  const fmtMin = (sec) => (sec < 50 ? '1분 이내' : `약 ${Math.round(sec / 60)}분`);
  let app = null, DL = null;
  const G = { offer: null, kind: null, map: null, mapFloor: null, liveT: 0, timer: 0, countT: 0, passed: null };

  const srv = () => (DL && DL.state()) || null;
  const mode = () => { const s = srv(); return s && s.robot ? s.robot.mode : null; };
  const guiding = () => GUIDE_MODES.includes(mode());
  const target = () => { const s = srv(); return s && s.robot ? s.robot.target : null; };
  const destRoom = () => { const t = target(); return t && t.room ? D.roomById(t.room) : null; };
  const destName = (room) => (G.kind === 'restroom' ? '가장 가까운 화장실' : G.kind === 'elevator' ? '가장 가까운 엘리베이터' : RT.displayName(room));

  /* ── 데려다줄 수 있는지 ── */
  function offerFor(room) {
    const m = mode();
    if (!srv()) return { ok: false, reason: '로봇 연결을 확인하고 있어요' };
    if (GUIDE_MODES.includes(m)) return { ok: false, reason: '피콕이 다른 분을 안내하고 있어요' };
    if (!['idle', 'returning'].includes(m)) return { ok: false, reason: '피콕이 배달 중이라 지금은 못 가요' };
    const plan = RT.robotPlan(DL.currentPos(), room);
    if (!plan) return { ok: false, reason: '피콕이 갈 수 없는 곳이에요' };
    if (plan.total_m < 5) return { ok: false, reason: '목적지가 바로 가까이에 있어요' };
    const elevator = plan.nodes.some((n) => n.action === 'elevator');
    return { ok: true, room, plan, elevator, seconds: plan.total_m / speed() + (elevator ? 40 : 0) };
  }

  // 길 안내 화면 아래: 안내 방식 고르기
  function routeChoice(r) {
    if (!DL || !DL.enabled()) return null; // 로봇으로 등록되지 않은 기기는 QR 만
    const o = offerFor(r.room);
    G.offer = Object.assign(o, { route: r });
    const sub = o.ok ? `${o.elevator ? '엘리베이터 타고 ' : ''}문 앞까지 함께 가요 · ${fmtMin(o.seconds)}` : app.esc(o.reason);
    return `<div class="guide-choice" role="group" aria-label="안내 방식">
      <button class="guide-opt guide-escort" data-action="escort"${o.ok ? '' : ' disabled'}>
        <span class="guide-ico">${I('walk')}</span><span class="guide-text"><b>데려다주세요</b><small>${sub}</small></span></button>
      <button class="guide-opt guide-qr" data-action="qr">
        <span class="guide-ico">${I('qr')}</span><span class="guide-text"><b>QR로 받을게요</b><small>휴대폰으로 길 안내 가져가기</small></span></button>
    </div>`;
  }

  function start() {
    const o = G.offer;
    if (!o || !o.ok) { if (o) app.bubble(o.reason, false); return; }
    const end = o.plan.nodes[o.plan.nodes.length - 1];
    const name = RT.displayName(o.room);
    G.kind = app.state.current && app.state.current.params ? app.state.current.params.kind : null;
    DL.act('guide', { to_room: o.room.id, to_label: name, target: { room: o.room.id, label: name, floor: end.floor, x: end.x, y: end.y, plan: o.plan } })
      .then((ok) => {
        if (!ok) return;
        app.qr.close();
        G.passed = null;
        // 사람 길안내의 마지막 문장 ("도착! 보건실은 오른쪽에 있어요") — 도착했을 때 쓴다
        const last = o.route && o.route.steps[o.route.steps.length - 1];
        G.arriveLine = last && /왼쪽|오른쪽|정면/.test(last.text) ? last.text.replace(/^도착!\s*/, '') : null;
        app.go('escort', {}, { push: false });
        app.faces.mini.react('happy', 1600);
        app.bubble(`저를 따라오세요! ${destName(o.room)}까지 함께 갈게요.`);
      });
  }

  /* ── 진행 상황 (Router.locate) ── */
  function progressInfo() {
    const s = srv(), t = target();
    const plan = t && t.plan;
    if (!plan) return null;
    const loc = s.robot.progress ? RT.locate(plan, s.robot.progress, DL.now()) : null;
    let i = loc ? plan.nodes.findIndex((n) => n.key === loc.at) : 0;
    if (i < 0) i = 0;
    let remain = 0;
    plan.nodes.forEach((n, j) => { if (j >= i) remain += n.next_m || 0; });
    if (loc && loc.k) remain -= (plan.nodes[i].next_m || 0) * loc.k;
    // 앞으로 처음 할 일 (회전 · 엘리베이터 · 도착)
    let next = null;
    for (let j = i + 1; j < plan.nodes.length; j++) {
      const n = plan.nodes[j];
      if (TURN[n.action] || n.action === 'elevator' || n.action === 'stop') { next = n; break; }
    }
    return { plan, loc, remain: Math.max(0, remain), next, total: plan.total_m || 0 };
  }
  function nextText(n) {
    if (!n) return ['-', ''];
    if (n.action === 'stop') return ['곧 도착', '문 앞에서 멈춰요'];
    if (n.action === 'elevator') return ['엘리베이터', `엘리베이터 타고 ${n.toFloor}층으로 가요`];
    return [TURN[n.action], `${DL.nodeName(n.key).replace(/^\d+층 /, '')}에서 ${TURN[n.action]}으로 돌아요`];
  }

  /* ── 화면 ── */
  function escortView() {
    const room = destRoom(), t = target(), esc = app.esc;
    if (!guiding() || !room || !t) {
      return `<section class="view">${app.viewHead('데려다주기')}<div class="empty"><h2>지금 하는 안내가 없어요</h2></div></section>`;
    }
    const arrived = mode() === 'guided';
    const name = destName(room);
    const destRow = `<div class="dest"><span class="dest-badge cat-${room.cat}"><b>${room.floor}</b>층</span>
      <div class="dest-text"><h2>${esc(name)}</h2><p>${arrived ? '다 왔어요' : '문 앞까지 함께 가요'}</p></div></div>`;
    let panel;
    if (arrived) {
      const st = restSteps();
      panel = `<div class="esc-hero is-done"><span class="esc-ico">${I('arrive')}</span><div><p class="esc-kicker">데려다주기 완료</p><h2>도착했어요!</h2></div></div>
        ${destRow}
        <ol class="steps">${st.map((x) => `<li><div class="step is-cur step-${x.icon}"><span class="step-ico">${I(x.icon)}</span><span class="step-text">${esc(x.text)}</span><span class="step-floor">${x.floor}층</span></div></li>`).join('')}</ol>
        <p class="esc-count" id="gd-count"></p>
        <div class="route-actions">
          <button class="btn" data-action="gd-replay">${I('sound')}다시 듣기</button>
          <button class="btn btn-primary" data-action="gd-done">${I('home')}고마워요</button>
        </div>`;
    } else {
      const body = !!srv().robot.progress;
      const ev = DL.elevatorWait(); // 엘리베이터 앞에 멈춤: 사람이 태워 주고 내린 뒤 누름
      G.evShown = !!ev;
      panel = `<div class="esc-hero"><span class="esc-ico">${I('walk')}</span><div><p class="esc-kicker">데려다주기</p><h2 id="gd-headline">저를 따라오세요!</h2></div></div>
        ${destRow}
        <div class="esc-progress" aria-hidden="true"><i id="gd-bar"></i></div>
        <div class="dest-meta">
          <div><b id="gd-remain">-</b><span>남은 거리</span></div>
          <div><b id="gd-eta">-</b><span>남은 시간</span></div>
          <div><b id="gd-next">-</b><span>다음</span></div>
        </div>
        <p class="esc-now" id="gd-now"></p>
        <div class="esc-spacer"></div>
        <div class="route-actions">
          ${ev ? `<button class="btn btn-primary" data-action="gd-elevator-out" style="grid-column: span 2">${I('elevator')}${ev.toFloor}층에서 내렸어요 · 다시 출발</button>` : ''}
          ${body ? '' : `<button class="btn btn-primary" data-action="gd-arrived">${I('arrive')}다 왔어요</button>`}
          <button class="btn btn-stop" data-action="gd-cancel" ${body ? 'style="grid-column: span 2"' : ''}>${I('close')}그만할래요</button>
        </div>`;
    }
    return `<section class="view view-route view-escort">
      <div class="card route-map">
        <div class="map-top">
          <div class="esc-title">${I('walk')}<b>${arrived ? '도착' : '피콕을 따라오세요'}</b><span id="gd-floor"></span></div>
          <div class="map-legend"><span><i class="sw sw-robot"></i>피콕</span><span><i class="sw sw-route"></i>${arrived ? '남은 길' : '함께 가는 길'}</span></div>
        </div>
        <div class="map-host" id="gd-map"></div>
        <p class="dl-live gd-live" id="gd-live"></p>
      </div>
      <aside class="card route-panel esc-panel">${panel}</aside>
    </section>`;
  }

  // 로봇이 멈춘 곳(END) → 방 문까지 사람 길안내
  function restRoute() {
    const t = target(), room = destRoom();
    if (!t || !room) return null;
    return RT.route({ floor: t.floor, x: t.x, y: t.y, label: '피콕이 멈춘 곳' }, room, { mode: 'stairs' });
  }

  // 도착 뒤 남은 몇 걸음. 로봇이 문 바로 앞에 섰으면 한 줄로
  function restSteps() {
    const room = destRoom(), rest = restRoute();
    if (rest && rest.meters >= 4) return rest.steps.slice(1);
    const line = G.arriveLine || `${RT.josa(destName(room), '은/는')} 바로 앞에 있어요`;
    return [{ icon: 'arrive', floor: room.floor, text: `도착! ${line}` }];
  }

  function mountMap() {
    const host = $('#gd-map');
    clearInterval(G.liveT);
    if (!host || !guiding()) { G.map = null; return; }
    const info = progressInfo();
    G.map = new KIS.MapView(host, {});
    if (mode() === 'guided') {
      const rest = restRoute();
      const seg = rest && rest.segments[rest.segments.length - 1];
      G.mapFloor = seg ? seg.floor : target().floor;
      G.map.setFloor(G.mapFloor);
      if (seg) G.map.showRoute(seg, { isFirst: true, youLabel: '여기', room: destRoom() });
      G.map.robotDot(target().x, target().y);
    } else {
      G.mapFloor = info && info.loc ? info.loc.floor : info ? info.plan.nodes[0].floor : target().floor;
      G.map.setFloor(G.mapFloor);
      if (info) DL.drawPlan(G.map, info.plan, G.mapFloor);
      tick();
      G.liveT = setInterval(tick, 500);
    }
    const f = $('#gd-floor');
    if (f) f.textContent = `${G.mapFloor}층`;
  }

  function tick() {
    if (!$('#gd-map') || !G.map || mode() !== 'guiding') { clearInterval(G.liveT); return; }
    const p = progressInfo();
    if (!p) return;
    const set = (id, v) => { const e = document.getElementById(id); if (e && e.textContent !== v) e.textContent = v; };
    if (p.loc && p.loc.floor !== G.mapFloor) { mountMap(); return; }
    const live = $('#gd-live');
    if (!!DL.elevatorWait() !== !!G.evShown) { app.render(); return; } // 엘리베이터 대기 시작·끝
    if (p.loc && $('[data-action="gd-arrived"]')) { app.render(); return; } // 로봇 몸체가 보고를 시작함: 수동 도착 버튼 숨김
    if (p.loc) {
      G.map.robotDot(p.loc.x, p.loc.y);
      if (live) live.textContent = p.loc.inElevator ? '엘리베이터로 이동 중' : `${DL.nodeName(p.loc.at)} 지나는 중`;
      // 노드를 지날 때 짧게 말하기
      if (p.loc.at !== G.passed) {
        const n = p.plan.nodes.find((x) => x.key === p.loc.at);
        if (G.passed !== null && n) {
          if (TURN[n.action]) app.say(`${TURN[n.action]}으로 돌아요.`);
          else if (n.action === 'elevator') app.say('엘리베이터를 탈게요. 함께 타요!');
          else if (n.action === 'exit') app.say(`${n.floor}층이에요. 함께 내려요.`);
        }
        G.passed = p.loc.at;
      }
    } else {
      const s = p.plan.nodes[0];
      G.map.robotDot(s.x, s.y);
      if (live) live.textContent = '로봇 몸체가 연결되면 지도에서 실시간 위치가 보여요';
      if (G.passed === null) G.passed = '';
    }
    const [short, long] = nextText(p.next);
    set('gd-remain', RT.fmtMeters(p.remain));
    set('gd-eta', fmtMin(p.remain / speed()));
    set('gd-next', short);
    set('gd-now', long);
    set('gd-headline', p.loc && p.loc.inElevator ? '엘리베이터로 가요' : '저를 따라오세요!');
    const bar = $('#gd-bar');
    if (bar) bar.style.width = `${Math.round(p.total ? Math.min(1, 1 - p.remain / p.total) * 100 : 0)}%`;
  }

  /* ── 도착 · 마치기 ── */
  function arriveSpeech() {
    const room = destRoom();
    if (!room) return;
    const st = restSteps();
    const last = st[st.length - 1].text.replace(/^도착!\s*/, '');
    const text = st.length > 1 ? `다 왔어요! ${st.slice(0, -1).map((x) => x.text).join('. ')}. ${last}.` : `도착했어요! ${last}.`;
    app.bubble('도착했어요!', false);
    app.say(text);
  }
  // 도착 후 아무도 안 누르면 이만큼 뒤에 제자리로 (누를 때마다 다시 셈)
  function armReturn() {
    clearTimeout(G.timer);
    clearInterval(G.countT);
    if (mode() !== 'guided') return;
    const sec = 25, until = Date.now() + sec * 1000;
    const show = () => {
      const c = $('#gd-count');
      if (c) c.textContent = `${Math.max(0, Math.ceil((until - Date.now()) / 1000))}초 뒤에 피콕은 제자리로 돌아가요`;
    };
    show();
    G.countT = setInterval(show, 1000);
    G.timer = setTimeout(finish, sec * 1000);
  }
  function stopTimers() { clearTimeout(G.timer); clearInterval(G.countT); clearInterval(G.liveT); }
  // 안내를 마치고 제자리로 (cancel: guiding|guided → returning). 화면은 배달 기능이 얼굴로 돌린다.
  function finish() {
    stopTimers();
    if (!guiding()) return;
    DL.act('cancel', {});
  }

  function onMode(prev, m) {
    if (m === 'guided') {
      app.showApp();
      app.go('escort', {}, { push: false });
      app.faces.mini.react('happy', 1800);
      if (prev !== undefined) arriveSpeech();
      armReturn();
    } else if (m === 'guiding' && prev === undefined) {
      // 화면을 다시 열었을 때 안내 중이면 이어서 보여 준다
      app.showApp();
      app.go('escort', {}, { push: false });
    } else if (!GUIDE_MODES.includes(m)) {
      stopTimers();
      if (app.state.current && app.state.current.view === 'escort') app.goHome();
    }
  }

  function init(theApp) {
    app = theApp;
    DL = KIS.Delivery;
    if (!DL || !DL.enabled()) return; // 로봇 기기가 아니면 QR 만 (길 안내 화면은 그대로)
    const h = app.hooks;
    app.views.escort = escortView;
    const wrap = (name, fn) => { const prev = h[name]; h[name] = (...a) => fn(prev, ...a); };
    h.routeChoice = (r) => routeChoice(r);
    h.routeAsk = (r) => !!(G.offer && G.offer.route === r && G.offer.ok);
    h.here = () => (srv() ? DL.currentPos() : null);
    h.holdIdle = () => {
      if (mode() === 'guiding') return true;
      if (mode() === 'guided') { armReturn(); return true; }
      return false;
    };
    wrap('onRender', (prev, view, params) => {
      if (prev) prev(view, params);
      if (view === 'escort') mountMap(); else clearInterval(G.liveT);
    });
    wrap('onAction', (prev, a, id, b) => {
      switch (a) {
        case 'escort': start(); return;
        case 'gd-arrived': DL.act('arrived', {}); return;
        case 'gd-elevator-out': {
          // 로봇 몸체(ESP32·mBot2)는 '지난 노드'가 엘리베이터 출구로 바뀌면 이어서 출발한다 (배달과 같은 방식)
          const ev = DL.elevatorWait(), r = srv().robot;
          if (ev) DL.act('progress', { passed: ev.exit, next: ev.after, speed: r.progress && r.progress.speed });
          return;
        }
        case 'gd-cancel':
          stopTimers();
          DL.act('cancel', {}).then((ok) => { if (ok) app.say('안내를 멈출게요. 저는 제자리로 돌아갈게요.'); });
          return;
        case 'gd-done': app.say('천만에요! 저는 제자리로 돌아갈게요.'); finish(); return;
        case 'gd-replay': arriveSpeech(); return;
        default: if (prev) prev(a, id, b);
      }
    });
    wrap('onWake', (prev) => {
      if (guiding()) { app.showApp(); app.go('escort', {}, { push: false }); return true; }
      return prev ? prev() : false;
    });
    wrap('onHome', (prev) => {
      if (guiding()) { app.go('escort', {}, { push: false }); return true; }
      return prev ? prev() : false;
    });
    wrap('missionLine', (prev) => {
      const room = destRoom();
      if (mode() === 'guiding' && room) return `${RT.josa(RT.displayName(room), '으로/로')} 길 안내 중이에요`;
      if (mode() === 'guided') return '다 왔어요! 화면을 눌러 주세요';
      return prev ? prev() : null;
    });
    DL.onMode(onMode);
  }

  return { init };
})();
