/* 피콕 부르기 (index.html) — 휴대폰·PC 누구나
 *  1) 어디로 와 줄지 고르기 → 2) 부르기 → 3) 진행 상황 보기(대기·오는 중·도착·배달 중·완료) / 취소
 *  로봇이 도착하면 물건 싣기·받는 곳·받는 사람·메모는 로봇 화면에서 한다.
 */
(function () {
  const CFG = KIS.CONFIG, D = KIS.DATA, RT = KIS.Router, S = KIS.Search, I = KIS.icon;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const main = $('#c-main');
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 */ } },
  };
  let client = store.get('kis-client');
  if (!client) { client = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('kis-client', client); }

  KIS.createFace($('#c-avatar'), { mini: true });

  const form = { place: null, caller: store.get('kis-caller-name') || '', note: '', q: '' };
  let active = store.get('kis-call');   // { id, token }
  let last = null, skew = 0, pollT = null, mapView = null, mapFloor = null, liveT = null;

  const nameOf = (r) => (r ? RT.displayName(r) : '');
  const reachable = (r) => !!RT.robotPlan(CFG.robotLocation, r);

  async function api(method, path, body) {
    const res = await fetch(path, { method, cache: 'no-store', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || `서버 응답 ${res.status}`); e.status = res.status; throw e; }
    return data;
  }

  /* ── 로봇 상태 표시 (위쪽) ── */
  const MODE = { idle: '쉬는 중', to_caller: '호출 받고 이동 중', loading: '물건 싣는 중', delivering: '배달 중', at_recipient: '배달 도착', returning: '돌아가는 중', guiding: '길 안내 중', guided: '길 안내 중' };
  async function refreshStatus() {
    try {
      const s = await api('GET', '/api/status');
      const el = $('#c-status');
      el.className = `c-status ${s.robot.online ? (s.robot.mode === 'idle' ? 'is-free' : 'is-busy') : 'is-off'}`;
      el.querySelector('em').textContent = s.robot.online ? `${MODE[s.robot.mode] || s.robot.mode}${s.waiting ? ` · 대기 ${s.waiting}건` : ''}` : '로봇 꺼짐';
    } catch (e) { $('#c-status em').textContent = '연결 안 됨'; }
  }

  /* ── 1) 부르기 화면 ── */
  const QUICK = ['교무실 (초)', '교무실 (중등)', '행정실1', '보건실', '도서실', '교장실', '교감실·교무실 (기획·과정·연구)'];
  function renderForm(msg) {
    stopLive();
    const p = form.place ? D.roomById(form.place) : null;
    const grades = [['', '학년'], ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((g) => [g, `${g}학년`])];
    main.innerHTML = `
      <section class="c-card c-intro">
        <h1>피콕에게 배달을 맡겨 보세요</h1>
        <ol class="c-how">
          <li><b>1</b>여기서 피콕을 불러요</li>
          <li><b>2</b>피콕이 오면 물건을 넣어요</li>
          <li><b>3</b>로봇 화면에서 받는 곳과 받는 사람을 골라요</li>
        </ol>
      </section>
      <section class="c-card">
        <h2>${I('pin')}어디로 와 줄까요?</h2>
        ${p ? `<div class="c-picked">
            <span class="c-badge cat-${p.cat}"><b>${p.floor}</b>층</span>
            <div><b>${esc(nameOf(p))}</b><small>${reachable(p) ? '피콕이 갈 수 있어요' : '<em>피콕이 갈 수 없는 곳이에요 (엘리베이터로 못 감)</em>'}</small></div>
            <button class="c-btn c-btn-ghost" data-act="unpick">바꾸기</button>
          </div>` : `
          <div class="c-search">
            ${I('search')}<input id="c-q" type="search" inputmode="search" autocomplete="off" enterkeyhint="search" placeholder="교실·장소 이름 (예: 5-1, 보건실)" value="${esc(form.q)}">
          </div>
          <div id="c-results" class="c-results"></div>
          <div class="c-class">
            <select id="c-grade" aria-label="학년">${grades.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
            <select id="c-klass" aria-label="반" disabled><option value="">반</option></select>
          </div>
          <div class="c-chips">${QUICK.map((n) => D.rooms().find((r) => r.name === n)).filter(Boolean).map((r) => `<button class="c-chip cat-${r.cat}" data-act="pick" data-id="${r.id}">${esc(nameOf(r))}</button>`).join('')}</div>`}
      </section>
      <section class="c-card">
        <h2>${I('chat')}더 알려 주세요 <small>(선택)</small></h2>
        <label class="c-field"><span>보내는 사람</span><input id="c-caller" maxlength="30" autocomplete="name" placeholder="예: 김민지 (5-1)" value="${esc(form.caller)}"></label>
        <label class="c-field"><span>보낼 물건</span><input id="c-note" maxlength="80" placeholder="예: 출석부, 보건 서류" value="${esc(form.note)}"></label>
      </section>
      ${msg ? `<p class="c-error">${esc(msg)}</p>` : ''}
      <button class="c-btn c-btn-main" data-act="call" ${p && reachable(p) ? '' : 'disabled'}>${I('box')}피콕 부르기</button>`;
    const q = $('#c-q');
    if (q) {
      q.addEventListener('input', () => { form.q = q.value; renderResults(); });
      renderResults();
      const gs = $('#c-grade'), ks = $('#c-klass');
      gs.addEventListener('change', () => {
        const g = Number(gs.value);
        const list = D.rooms().filter((r) => r.group === 'class' && r.grade === g).sort((a, b) => a.klass - b.klass);
        ks.innerHTML = `<option value="">반</option>${list.map((r) => `<option value="${r.id}">${r.klass}반 · ${r.floor}층</option>`).join('')}`;
        ks.disabled = !list.length;
      });
      ks.addEventListener('change', () => { if (ks.value) pick(ks.value); });
    }
    ['c-caller', 'c-note'].forEach((id) => {
      const el = $(`#${id}`);
      el.addEventListener('input', () => { form[id === 'c-caller' ? 'caller' : 'note'] = el.value; });
    });
  }
  function renderResults() {
    const box = $('#c-results');
    if (!box) return;
    const res = form.q.trim() ? S.search(form.q).filter((x) => x.room).slice(0, 6) : [];
    box.innerHTML = res.map((x) => `<button class="c-result cat-${x.room.cat}" data-act="pick" data-id="${x.room.id}">
      <span class="c-badge"><b>${x.room.floor}</b>층</span><b>${esc(nameOf(x.room))}</b><small>${esc(D.catNames[x.room.cat] || '')}</small></button>`).join('')
      || (form.q.trim() ? '<p class="c-hint">맞는 장소가 없어요. 다른 이름으로 찾아보세요.</p>' : '');
  }
  function pick(id) { form.place = id; form.q = ''; renderForm(); }

  async function doCall() {
    const p = D.roomById(form.place);
    if (!p) return;
    const btn = main.querySelector('[data-act="call"]');
    btn.disabled = true;
    btn.textContent = '부르는 중…';
    try {
      store.set('kis-caller-name', form.caller || '');
      const r = await api('POST', '/api/calls', { from_room: p.id, from_label: nameOf(p), caller: form.caller, note: form.note, client });
      active = { id: r.id, token: r.token };
      store.set('kis-call', active);
      last = null;
      poll();
    } catch (e) {
      renderForm(e.message);
    }
  }

  /* ── 2) 진행 상황 ── */
  const STEPS = [['waiting', '접수'], ['coming', '오는 중'], ['loading', '물건 싣기'], ['delivering', '배달 중'], ['delivered', '완료']];
  const stepIndex = (s) => ({ waiting: 0, coming: 1, loading: 2, delivering: 3, at_recipient: 3, delivered: 4 }[s] ?? 0);

  async function poll() {
    clearTimeout(pollT);
    if (!active) { renderForm(); return; }
    try {
      const r = await api('GET', `/api/calls/${active.id}?t=${encodeURIComponent(active.token)}`);
      skew = (r.now || Date.now()) - Date.now();
      const changed = !last || last.call.status !== r.call.status;
      if (changed && last && r.call.status === 'loading' && navigator.vibrate) navigator.vibrate([200, 100, 200]);
      last = r;
      renderStatus(changed);
      const done = ['delivered', 'canceled', 'expired'].includes(r.call.status);
      if (!done) pollT = setTimeout(poll, 3000);
    } catch (e) {
      if (e.status === 404) { active = null; store.set('kis-call', null); renderForm(); return; }
      pollT = setTimeout(poll, 5000);
    }
  }

  function renderStatus(rebuild) {
    const { call: c, ahead, robot } = last;
    const chip = $('#c-status');
    chip.className = `c-status ${robot.online ? (robot.mode === 'idle' ? 'is-free' : 'is-busy') : 'is-off'}`;
    chip.querySelector('em').textContent = robot.online ? (MODE[robot.mode] || robot.mode) : '로봇 꺼짐';
    const st = c.status;
    const from = esc(c.from_label || nameOf(D.roomById(c.from_room)));
    const to = esc(c.to_label || (c.to_room ? nameOf(D.roomById(c.to_room)) : ''));
    const head = {
      waiting: [`${ahead ? `앞에 ${ahead}건이 기다리고 있어요` : '곧 피콕이 출발해요'}`, robot.online ? (robot.busy ? '피콕이 다른 배달을 하고 있어요. 차례가 되면 바로 갈게요.' : '피콕이 호출을 확인하고 있어요.') : '피콕 화면이 꺼져 있어요. 켜지면 바로 갈게요.'],
      coming: ['피콕이 가고 있어요!', `${RT.josa(from, '으로/로')} 가는 중이에요. 조금만 기다려 주세요.`],
      loading: ['피콕이 도착했어요!', '로봇에 물건을 넣고, 로봇 화면에서 받는 곳과 받는 사람을 골라 주세요.'],
      delivering: ['배달 중이에요', `${RT.josa(to, '으로/로')} 가고 있어요.`],
      at_recipient: ['받는 곳에 도착했어요', `${to}에서 물건을 꺼내 가길 기다리고 있어요.`],
      delivered: ['배달 완료!', `${to}에 ${c.recipient ? `${esc(/님$/.test(c.recipient) ? c.recipient : `${c.recipient}님`)}께 ` : ''}잘 전했어요. 고마워요!`],
      canceled: ['호출이 취소됐어요', '다시 부를 수 있어요.'],
      expired: ['호출이 만료됐어요', '30분 동안 피콕이 오지 못했어요. 다시 불러 주세요.'],
    }[st] || ['', ''];
    const ended = ['delivered', 'canceled', 'expired'].includes(st);
    const showMap = robot.mine && robot.target && robot.target.plan && ['coming', 'delivering'].includes(st);
    if (!rebuild && $('#c-state') && $('#c-state').dataset.st === st) { updateLive(); return; }
    stopLive();
    main.innerHTML = `
      <section class="c-card c-state st-${st}" id="c-state" data-st="${st}">
        <div class="c-state-face" id="c-face"></div>
        <h1>${head[0]}</h1>
        <p>${head[1]}</p>
        ${!['canceled', 'expired'].includes(st) ? `<ol class="c-progress">${STEPS.map(([k, t], i) => `<li class="${i < stepIndex(st) || st === 'delivered' ? 'is-done' : i === stepIndex(st) ? 'is-on' : ''}"><i></i><span>${t}</span></li>`).join('')}</ol>` : ''}
      </section>
      ${showMap ? `<section class="c-card c-live"><h2>${I('pin')}피콕 위치 <small id="c-live-text"></small></h2><div class="c-map" id="c-map"></div></section>` : ''}
      <section class="c-card c-detail">
        <p>${I('pin')}부른 곳 <b>${from}</b></p>
        ${c.caller ? `<p>${I('phone')}보내는 사람 <b>${esc(c.caller)}</b></p>` : ''}
        ${c.caller_note ? `<p>${I('chat')}보낼 물건 <b>${esc(c.caller_note)}</b></p>` : ''}
        ${c.to_room ? `<p>${I('arrive')}받는 곳 <b>${to}</b>${c.recipient ? ` · ${esc(c.recipient)}` : ''}</p>` : ''}
        ${c.memo ? `<p>${I('chat')}메모 <b>${esc(c.memo)}</b></p>` : ''}
      </section>
      ${['waiting', 'coming'].includes(st) ? '<button class="c-btn c-btn-ghost c-btn-wide" data-act="cancel">호출 취소</button>' : ''}
      ${ended ? '<button class="c-btn c-btn-main" data-act="again">새로 부르기</button>' : ''}`;
    const face = KIS.createFace($('#c-face'), { mini: true });
    face.setMood(st === 'delivered' || st === 'loading' ? 'happy' : ['canceled', 'expired'].includes(st) ? 'sad' : 'idle');
    if (showMap) mountLive();
  }

  /* 피콕 실시간 위치 (로봇 몸체가 노드 통과를 보고할 때) */
  function mountLive() {
    const t = last.robot.target;
    const loc = last.robot.progress ? RT.locate(t.plan, last.robot.progress, Date.now() + skew) : null;
    const floor = loc ? loc.floor : t.floor;
    mapView = new KIS.MapView($('#c-map'), {});
    mapView.setFloor(floor);
    mapFloor = floor;
    const pts = t.plan.nodes.filter((n) => n.floor === floor);
    const room = t.room ? D.roomById(t.room) : null;
    if (pts.length) {
      const seg = { floor, draw: pts.map((n) => [n.x, n.y]), via: null };
      if (seg.draw.length === 1) seg.draw.push(seg.draw[0]);
      mapView.showRoute(seg, { isFirst: t.plan.nodes[0].floor === floor, room, youLabel: '출발' });
      const all = pts.map((n) => [n.x, n.y]);
      if (room && room.floor === floor) room.rects.forEach((rc) => all.push([rc[0], rc[1]], [rc[2], rc[3]]));
      requestAnimationFrame(() => mapView && mapView.fit(all, 30, 220));
    }
    updateLive();
    liveT = setInterval(updateLive, 500);
  }
  function updateLive() {
    if (!mapView || !last || !last.robot.target) return;
    const loc = last.robot.progress ? RT.locate(last.robot.target.plan, last.robot.progress, Date.now() + skew) : null;
    const txt = $('#c-live-text');
    if (!loc) { mapView.hideRobot(); if (txt) txt.textContent = '· 출발 준비 중'; return; }
    if (loc.floor !== mapFloor) { stopLive(); mountLive(); return; }
    mapView.robotDot(loc.x, loc.y);
    if (txt) txt.textContent = loc.inElevator ? '· 엘리베이터로 이동 중' : `· ${loc.floor}층에서 이동 중`;
  }
  function stopLive() { clearInterval(liveT); liveT = null; mapView = null; }

  /* ── 버튼 ── */
  main.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'pick') pick(b.dataset.id);
    if (a === 'unpick') { form.place = null; renderForm(); }
    if (a === 'call') doCall();
    if (a === 'cancel') {
      if (!window.confirm('호출을 취소할까요?')) return;
      try { await api('POST', `/api/calls/${active.id}/cancel?t=${encodeURIComponent(active.token)}`); } catch (err) { window.alert(err.message); }
      poll();
    }
    if (a === 'again') { active = null; last = null; store.set('kis-call', null); form.note = ''; renderForm(); }
  });
  main.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'c-q') {
      const first = main.querySelector('#c-results [data-act="pick"]');
      if (first) first.click();
    }
  });

  refreshStatus();
  setInterval(refreshStatus, 10000);
  if (active) poll(); else renderForm();
})();
