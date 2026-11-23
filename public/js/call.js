/* 피콕 부르기 (index.html) — 휴대폰 우선, 한국어 / English
 *  부르기: 1) 부를 곳 → 2) 보낼 물건 → 3) 확인 후 부르기
 *  진행 상황: 접수 → 오는 중 → 물건 싣기 → 배달 중 → 완료 (3초마다 확인) + 피콕 실시간 위치
 *  로봇이 도착하면 받는 곳·받는 사람·메모는 로봇 화면에서 고른다.
 */
(function () {
  const CFG = KIS.CONFIG, D = KIS.DATA, RT = KIS.Router, S = KIS.Search, I = KIS.icon, L = KIS.I18N;
  const t = (k) => L.t(k);
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const main = $('#c-main');
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 */ } },
  };
  let client = store.get('kis-client');
  if (!client) { client = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('kis-client', client); }

  // 시범 코스가 있으면 코스에 있는 방만 부를 수 있음
  const callable = D.rooms().filter((r) => r.searchable && !['restroom', 'elev'].includes(r.cat) && (!RT.robotCourse || RT.robotReachable(r)));
  const callFloors = D.floors.filter((f) => callable.some((r) => r.floor === f.id));
  const GROUPS = [['class', 'classroom'], ['office', 'office'], ['special', 'flask'], ['facility', 'star']];
  const KINDS = [['docs', 'book'], ['item', 'box'], ['food', 'coffee'], ['other', 'chat']];
  const KIND_KO = { docs: '서류', item: '물건', food: '간식·음료', other: '' };
  const nameOf = (r) => (r ? L.roomName(r) : '');
  const reachable = (r) => RT.robotReachable(r);
  const sortRooms = (a, b) => (a.group === 'class' && b.group === 'class' ? a.grade - b.grade || a.klass - b.klass : nameOf(a).localeCompare(nameOf(b), L.lang, { numeric: true }));

  const form = { step: 1, floor: (callFloors[0] || D.floors[0]).id, place: null, q: '', kind: '', note: '', caller: store.get('kis-caller-name') || '' };
  let active = store.get('kis-call');   // { id, token }
  let last = null, skew = 0, pollT = null, mapView = null, mapFloor = null, liveT = null, robotNow = null, errMsg = '', cancelArm = false;

  async function api(method, path, body) {
    const res = await fetch(path, { method, cache: 'no-store', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(L.lang === 'ko' && data.error ? data.error : t('netFail')); e.status = res.status; throw e; }
    return data;
  }

  /* ── 머리글: 언어 · 로봇 상태 · 얼굴 · 단계 ── */
  function statusChip() {
    const r = robotNow;
    if (!r) return `<span class="c-status"><i></i>${esc(t('checking'))}</span>`;
    if (r.error) return `<span class="c-status is-off"><i></i>${esc(t('noConn'))}</span>`;
    const cls = r.online ? (r.mode === 'idle' ? 'is-free' : 'is-busy') : 'is-off';
    const txt = r.online ? `${t('mode')[r.mode] || r.mode}${r.waiting ? t('waitingN')(r.waiting) : ''}` : t('robotOff');
    return `<span class="c-status ${cls}"><i></i>${esc(txt)}</span>`;
  }
  function renderTop(head, st) {
    const top = $('#c-top');
    top.className = `c-top${st ? ` st-${st}` : ''}`;
    top.innerHTML = `
      <div class="c-bar">
        <div class="c-brand"><b>${esc(t('appTitle'))}</b><span id="c-chip">${statusChip()}</span></div>
        <button class="c-lang" type="button" data-act="lang" aria-label="${esc(t('langLabel'))}">${I('chat')}${esc(t('langBtn'))}</button>
      </div>
      <div class="c-hero">
        <div class="c-face" id="c-face"></div>
        <div class="c-hero-text"><h1>${esc(head[0])}</h1><p>${esc(head[1])}</p></div>
      </div>
      ${st ? '' : `<ol class="c-stepper">${[t('stepWhere'), t('stepWhat'), t('stepCheck')].map((s, i) => `<li class="${i + 1 < form.step ? 'is-done' : i + 1 === form.step ? 'is-now' : ''}"><span>${i + 1 < form.step ? I('check') : i + 1}</span>${esc(s)}</li>`).join('')}</ol>`}`;
    const face = KIS.createFace($('#c-face'), { mini: true });
    if (st) face.setMood(st === 'delivered' || st === 'loading' ? 'happy' : ['canceled', 'expired'].includes(st) ? 'sad' : 'idle');
    document.title = t('appTitle');
  }
  function paintChip() { const c = $('#c-chip'); if (c) c.innerHTML = statusChip(); }

  async function refreshStatus() {
    try {
      const s = await api('GET', '/api/status');
      robotNow = Object.assign({}, s.robot, { waiting: s.waiting });
    } catch (e) { robotNow = { error: true }; }
    if (!active) paintChip();
  }

  /* ───────── 1) 부르기 ───────── */
  const picked = () => (form.place ? D.roomById(form.place) : null);

  function renderForm() {
    stopLive();
    renderTop([t('heroHi'), t('heroText')], null);
    const body = form.step === 1 ? stepWhere() : form.step === 2 ? stepWhat() : stepCheck();
    const p = picked();
    const canNext = form.step !== 1 || (p && reachable(p));
    main.innerHTML = `${body}
      ${errMsg ? `<p class="c-error" role="alert">${esc(errMsg)}</p>` : ''}
      <div class="c-actions">
        ${form.step > 1 ? `<button class="c-btn c-btn-ghost" type="button" data-act="prev">${I('back')}${esc(t('back'))}</button>` : ''}
        ${form.step < 3
          ? `<button class="c-btn c-btn-main" type="button" data-act="next" ${canNext ? '' : 'disabled'}>${esc(t('next'))}${I('chevron')}</button>`
          : `<button class="c-btn c-btn-main c-btn-send" type="button" data-act="call">${I('box')}${esc(t('send'))}</button>`}
      </div>`;
    errMsg = '';
    if (form.step === 1) renderRooms();
  }

  function placeCard(changeAct, showReach) {
    const r = picked();
    if (!r) return '';
    const ok = reachable(r);
    return `<div class="c-place">
      <span class="c-badge cat-${r.cat}"><b>${r.floor}</b><small>${esc(t('floorShort'))}</small></span>
      <div><b>${esc(nameOf(r))}</b>${showReach ? `<span class="${ok ? 'is-ok' : 'is-no'}">${I(ok ? 'check' : 'close')}${esc(ok ? t('reachable') : t('unreachable'))}</span>` : `<span>${esc(t('floor')(r.floor))}</span>`}</div>
      ${changeAct ? `<button type="button" class="c-chip-btn" data-act="${changeAct}">${esc(t('change'))}</button>` : ''}
    </div>`;
  }

  function stepWhere() {
    const recent = (store.get('kis-call-recent') || []).map((id) => D.roomById(id)).filter(Boolean).slice(0, 4);
    return `<section class="c-card">
      <ol class="c-how">${t('how').map((h, i) => `<li><b>${i + 1}</b>${esc(h)}</li>`).join('')}</ol>
    </section>
    <section class="c-card">
      <header class="c-head"><h2>${esc(t('whereTitle'))}</h2><p>${esc(t('whereSub'))}</p></header>
      ${picked() ? placeCard('unpick', true) : `
      <label class="c-search">${I('search')}<input id="c-q" type="search" placeholder="${esc(t('searchPh'))}" autocomplete="off" enterkeyhint="search" value="${esc(form.q)}"></label>
      ${recent.length ? `<div class="c-recent"><span>${esc(t('recent'))}</span><div>${recent.map((r) => `<button type="button" data-room="${esc(r.id)}">${I('star')}${esc(nameOf(r))}</button>`).join('')}</div></div>` : ''}
      <div class="c-floors" id="c-floors">${callFloors.map((f) => `<button type="button" data-floor="${f.id}"><b>${f.id}</b>${esc(t('floorShort'))}</button>`).join('')}</div>
      <div class="c-rooms" id="c-rooms"></div>`}
    </section>`;
  }

  const roomBtn = (r, showFloor) => `<button type="button" class="c-room cat-${r.cat}${reachable(r) ? '' : ' is-no'}" data-room="${esc(r.id)}">
    <i></i><span>${esc(nameOf(r))}</span>${showFloor ? `<small>${esc(t('floor')(r.floor))}</small>` : ''}</button>`;

  function renderRooms() {
    const host = $('#c-rooms');
    if (!host) return;
    const q = form.q.trim();
    document.querySelectorAll('#c-floors button').forEach((b) => b.classList.toggle('is-on', !q && Number(b.dataset.floor) === form.floor));
    if (q) {
      const ql = q.toLowerCase();
      const hits = S.search(q, { limit: 30 }).filter((h) => h.room && callable.includes(h.room)).map((h) => h.room);
      callable.forEach((r) => { if (!hits.includes(r) && L.enName(r).toLowerCase().includes(ql)) hits.push(r); });
      host.innerHTML = hits.length ? `<div class="c-list">${hits.slice(0, 30).map((r) => roomBtn(r, true)).join('')}</div>` : `<p class="c-none">${esc(t('noRooms'))}</p>`;
      return;
    }
    const rooms = callable.filter((r) => r.floor === form.floor);
    host.innerHTML = GROUPS.map(([g, icon]) => {
      const rs = rooms.filter((r) => r.group === g).sort(sortRooms);
      if (!rs.length) return '';
      return `<div class="c-group"><h3>${I(icon)}${esc(t('groups')[g])}<span>${rs.length}</span></h3>
        <div class="c-list ${g === 'class' && rs.every((r) => r.grade > 0) ? 'is-class' : ''}">${rs.map((r) => roomBtn(r, false)).join('')}</div></div>`;
    }).join('');
  }

  function stepWhat() {
    return `<section class="c-card">
      <header class="c-head"><h2>${esc(t('whatTitle'))}</h2><p>${esc(t('whatSub'))}</p></header>
      <div class="c-kinds">${KINDS.map(([k, icon]) => {
        const [title, sub] = t('kinds')[k];
        return `<button type="button" class="c-kind ${form.kind === k ? 'is-on' : ''}" data-kind="${k}" aria-pressed="${form.kind === k}">
          <span class="c-kind-ico">${I(icon)}</span><b>${esc(title)}</b><small>${esc(sub)}</small><i class="c-kind-check">${I('check')}</i></button>`;
      }).join('')}</div>
      <input id="c-note" class="c-input" maxlength="70" placeholder="${esc(t('notePh'))}" value="${esc(form.note)}">
    </section>`;
  }

  function stepCheck() {
    const kind = form.kind ? t('kinds')[form.kind][0] : '';
    return `<section class="c-card">
      <header class="c-head"><h2>${esc(t('checkTitle'))}</h2><p>${esc(t('checkSub'))}</p></header>
      <dl class="c-sum">
        <div><dt>${esc(t('to'))}</dt><dd>${placeCard('edit1', false)}</dd></div>
        ${kind || form.note ? `<div><dt>${esc(t('request'))}</dt><dd class="c-req">
          <div>${kind ? `<span class="c-tag">${esc(kind)}</span>` : ''}${form.note ? `<p>${esc(form.note)}</p>` : ''}</div>
          <button type="button" class="c-chip-btn" data-act="edit2">${esc(t('change'))}</button></dd></div>` : ''}
      </dl>
      <label class="c-field"><span>${esc(t('name'))}</span>
        <input id="c-caller" class="c-input" maxlength="30" placeholder="${esc(t('namePh'))}" value="${esc(form.caller)}" autocomplete="name"></label>
    </section>`;
  }

  function go(step) { form.step = step; renderForm(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

  main.addEventListener('input', (e) => {
    const id = e.target.id;
    if (id === 'c-q') { form.q = e.target.value; renderRooms(); }
    if (id === 'c-note') form.note = e.target.value;
    if (id === 'c-caller') form.caller = e.target.value;
  });
  main.addEventListener('keydown', (e) => {
    if (e.target.id === 'c-q' && e.key === 'Enter') { const first = main.querySelector('#c-rooms [data-room]'); if (first) first.click(); else e.target.blur(); }
  });

  async function doCall(btn) {
    const p = picked();
    if (!p || !reachable(p)) { errMsg = t('needPlace'); go(1); return; }
    btn.disabled = true;
    btn.innerHTML = `<i class="c-spin"></i>${esc(t('sending'))}`;
    const kindKo = KIND_KO[form.kind] || '';
    const note = [kindKo, form.note.trim()].filter(Boolean).join(' · ').slice(0, 80);
    try {
      store.set('kis-caller-name', form.caller.trim());
      const r = await api('POST', '/api/calls', { from_room: p.id, from_label: RT.displayName(p), caller: form.caller.trim(), note, client });
      active = { id: r.id, token: r.token };
      store.set('kis-call', active);
      store.set('kis-call-recent', [p.id, ...(store.get('kis-call-recent') || []).filter((x) => x !== p.id)].slice(0, 6));
      last = null;
      window.scrollTo(0, 0);
      poll();
    } catch (e) {
      errMsg = e.message;
      renderForm();
    }
  }

  /* ───────── 2) 진행 상황 ───────── */
  const stepIndex = (s) => ({ waiting: 0, coming: 1, loading: 2, delivering: 3, at_recipient: 3, delivered: 4 }[s] ?? 0);
  const STEP_ICON = ['bell', 'delivery', 'box', 'map', 'check'];

  async function poll() {
    clearTimeout(pollT);
    if (!active) { renderForm(); return; }
    try {
      const r = await api('GET', `/api/calls/${active.id}?t=${encodeURIComponent(active.token)}`);
      skew = (r.now || Date.now()) - Date.now();
      robotNow = r.robot;
      const changed = !last || last.call.status !== r.call.status || last.ahead !== r.ahead;
      if (last && last.call.status !== r.call.status && navigator.vibrate) navigator.vibrate(r.call.status === 'loading' ? [200, 100, 200] : [120]);
      last = r;
      const net = $('#c-net'); if (net) net.hidden = true;
      renderStatus(changed);
      if (!['delivered', 'canceled', 'expired'].includes(r.call.status)) pollT = setTimeout(poll, 3000);
    } catch (e) {
      if (e.status === 404) { active = null; store.set('kis-call', null); renderForm(); return; }
      const net = $('#c-net'); if (net) { net.hidden = false; net.textContent = t('offline'); }
      pollT = setTimeout(poll, 5000);
    }
  }

  function renderStatus(rebuild) {
    const { call: c, ahead, robot } = last;
    const st = c.status;
    if (!rebuild && $('#c-state') && $('#c-state').dataset.st === st) { paintChip(); updateLive(); return; }
    stopLive();
    const fromRoom = D.roomById(c.from_room), toRoom = c.to_room ? D.roomById(c.to_room) : null;
    const from = fromRoom ? nameOf(fromRoom) : c.from_label || '';
    const to = toRoom ? nameOf(toRoom) : c.to_label || '';
    const fn = t('st')[st] || t('st').waiting;
    const head = fn({ ahead, online: robot.online, busy: robot.busy, from, to, recipient: c.recipient ? c.recipient.replace(/님$/, '') : '' });
    renderTop(head, st);
    const ended = ['delivered', 'canceled', 'expired'].includes(st);
    const idx = stepIndex(st);
    const showMap = robot.mine && robot.target && robot.target.plan && ['coming', 'delivering'].includes(st);
    const row = (icon, label, val) => (val ? `<div><dt>${I(icon)}${esc(label)}</dt><dd>${esc(val)}</dd></div>` : '');
    main.innerHTML = `
      ${['canceled', 'expired'].includes(st) ? '' : `<section class="c-card c-track" id="c-state" data-st="${st}">
        <div class="c-progress"><i style="width:${[10, 32, 55, 78, 100][idx]}%"></i></div>
        <ol class="c-timeline">${t('steps').map((s, i) => {
          const done = i < idx || st === 'delivered';
          return `<li class="${done ? 'is-done' : i === idx ? 'is-now' : ''}"><span class="c-dot">${I(done ? 'check' : STEP_ICON[i])}</span><b>${esc(s)}</b></li>`;
        }).join('')}</ol>
        ${ended ? '' : `<p class="c-live-note"><i></i>${esc(t('liveNote'))}</p>`}
      </section>`}
      ${showMap ? `<section class="c-card c-route">
        <header class="c-route-head"><h2>${I('pin')}${esc(t('liveTitle'))}</h2><span id="c-live-text"></span></header>
        <div class="c-map" id="c-map"></div></section>` : ''}
      <section class="c-card" ${['canceled', 'expired'].includes(st) ? `id="c-state" data-st="${st}"` : ''}>
        ${fromRoom ? `<div class="c-place">
          <span class="c-badge cat-${fromRoom.cat}"><b>${fromRoom.floor}</b><small>${esc(t('floorShort'))}</small></span>
          <div><b>${esc(from)}</b><span>${esc(t('calledAt')(new Date(c.created_at || Date.now()).toLocaleTimeString(L.lang === 'ko' ? 'ko-KR' : 'en-US', { hour: 'numeric', minute: '2-digit' })))}</span></div>
        </div>` : ''}
        <dl class="c-detail">
          ${row('phone', t('d').caller, c.caller)}
          ${row('box', t('d').note, noteText(c.caller_note))}
          ${row('arrive', t('d').to, to ? `${to}${c.recipient ? ` · ${c.recipient}` : ''}` : '')}
          ${row('chat', t('d').memo, c.memo)}
        </dl>
      </section>
      <p class="c-error" id="c-net" hidden></p>
      <div class="c-actions is-static">
        ${['waiting', 'coming'].includes(st) ? `<button class="c-btn c-btn-danger ${cancelArm ? 'is-armed' : ''}" data-act="cancel" type="button">${I('close')}${esc(cancelArm ? t('cancelAsk') : t('cancel'))}</button>` : ''}
        ${ended ? `<button class="c-btn c-btn-main" data-act="again" type="button">${I('box')}${esc(t('again'))}</button>` : ''}
      </div>`;
    if (showMap) mountLive();
  }

  // 보낼 물건 앞의 종류(서류·물건·간식·음료)는 지금 언어로 바꿔 보여 준다
  function noteText(n) {
    if (!n) return '';
    for (const [k, ko] of Object.entries(KIND_KO)) {
      if (ko && (n === ko || n.startsWith(`${ko} · `))) return [t('kinds')[k][0], n.slice(ko.length + 3)].filter(Boolean).join(' · ');
    }
    return n;
  }

  /* 피콕 실시간 위치 (로봇 몸체가 노드 통과를 보고할 때) */
  function mountLive() {
    const tg = last.robot.target;
    const loc = last.robot.progress ? RT.locate(tg.plan, last.robot.progress, Date.now() + skew) : null;
    const floor = loc ? loc.floor : tg.floor;
    mapView = new KIS.MapView($('#c-map'), {});
    mapView.setFloor(floor);
    mapFloor = floor;
    const pts = tg.plan.nodes.filter((n) => n.floor === floor);
    const room = tg.room ? D.roomById(tg.room) : null;
    if (pts.length) {
      const seg = { floor, draw: pts.map((n) => [n.x, n.y]), via: null };
      if (seg.draw.length === 1) seg.draw.push(seg.draw[0]);
      const startsHere = tg.plan.nodes[0].floor === floor;
      const fi = tg.plan.nodes.findIndex((n) => n.floor === floor);
      const prev = fi > 0 ? tg.plan.nodes[fi - 1].floor : tg.plan.nodes[0].floor;
      mapView.showRoute(seg, { isFirst: true, room, youLabel: startsHere ? t('liveStart') : t('fromFloor')(prev) });
      const all = pts.map((n) => [n.x, n.y]);
      if (room && room.floor === floor) {
        room.rects.forEach((rc) => all.push([rc[0], rc[1]], [rc[2], rc[3]]));
        const ctr = RT.roomCenter(room);
        mapView.pill(ctr[0], ctr[1] - 27, nameOf(room), 'pill-go');
        all.push([ctr[0], ctr[1] - 34]);
      }
      requestAnimationFrame(() => mapView && mapView.fit(all, 30, 220));
    }
    updateLive();
    liveT = setInterval(updateLive, 500);
  }
  function updateLive() {
    if (!mapView || !last || !last.robot.target) return;
    const loc = last.robot.progress ? RT.locate(last.robot.target.plan, last.robot.progress, Date.now() + skew) : null;
    const txt = $('#c-live-text');
    if (!loc) { mapView.hideRobot(); if (txt) txt.textContent = t('liveReady'); return; }
    if (loc.floor !== mapFloor) { stopLive(); mountLive(); return; }
    mapView.robotDot(loc.x, loc.y);
    if (txt) txt.textContent = loc.inElevator ? t('liveElev') : t('liveMove')(loc.floor);
  }
  function stopLive() { clearInterval(liveT); liveT = null; mapView = null; }

  /* ── 버튼 ── */
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.floor) { form.floor = Number(d.floor); form.q = ''; const qi = $('#c-q'); if (qi) qi.value = ''; renderRooms(); return; }
    if (d.room) {
      const r = D.roomById(d.room);
      form.place = d.room; form.q = '';
      if (reachable(r)) go(2); else renderForm();
      return;
    }
    if (d.kind) {
      form.kind = form.kind === d.kind ? '' : d.kind;
      document.querySelectorAll('.c-kind').forEach((k) => { const on = k.dataset.kind === form.kind; k.classList.toggle('is-on', on); k.setAttribute('aria-pressed', on); });
      if (form.kind === 'other') $('#c-note').focus();
      return;
    }
    switch (d.act) {
      case 'lang':
        L.set(L.lang === 'ko' ? 'en' : 'ko');
        $('#c-foot').textContent = t('footer');
        if (active && last) renderStatus(true); else renderForm();
        break;
      case 'unpick': form.place = null; renderForm(); break;
      case 'edit1': form.place = null; go(1); break;
      case 'edit2': go(2); break;
      case 'prev': go(form.step - 1); break;
      case 'next': if (form.step === 1 && !(picked() && reachable(picked()))) { errMsg = t('needPlace'); renderForm(); } else go(form.step + 1); break;
      case 'call': doCall(b); break;
      case 'cancel':
        if (!cancelArm) { cancelArm = true; renderStatus(true); setTimeout(() => { if (cancelArm) { cancelArm = false; if (last) renderStatus(true); } }, 4000); break; }
        cancelArm = false;
        b.disabled = true;
        try { await api('POST', `/api/calls/${active.id}/cancel?t=${encodeURIComponent(active.token)}`); } catch (err) {
          const net = $('#c-net'); if (net) { net.hidden = false; net.textContent = err.message; }
        }
        poll();
        break;
      case 'again':
        active = null; last = null; store.set('kis-call', null);
        Object.assign(form, { step: 1, place: null, q: '', kind: '', note: '' });
        refreshStatus(); renderForm(); window.scrollTo(0, 0);
        break;
      default:
    }
  });

  /* ── 시작 ── */
  L.set(L.lang);
  $('#c-foot').textContent = t('footer');
  refreshStatus().then(() => { if (!active) paintChip(); });
  setInterval(() => { if (!active) refreshStatus(); }, 10000);
  if (active) {
    renderTop([t('loading'), ''], 'waiting');
    main.innerHTML = `<section class="c-card c-empty"><i class="c-spin"></i><p>${esc(t('loading'))}</p></section>`;
    poll();
  } else renderForm();
})();
