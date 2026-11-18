/* 배달 호출 화면 (call.html) — 세로 휴대폰 기준, 한국어 / English
 *   호출하기: 1) 장소 → 2) 요청 → 3) 확인 후 호출
 *   호출 상태: 접수 → 피콕 출발 → 도착 (4초마다 새로 확인) + 피콕이 오는 길 지도
 *   진행 중인 호출은 이 기기에 저장되어, 페이지를 닫았다 열어도 상태가 이어집니다.
 */
(function () {
  const CFG = KIS.CONFIG, D = KIS.DATA, RT = KIS.Router, S = KIS.Search, I = KIS.icon, L = KIS.I18N;
  const t = (k) => L.t(k);
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const main = $('#c-main');
  const POLL_MS = 4000;

  /* ── 이 기기에 저장 ── */
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 */ } },
  };
  const mine = { get: () => ls.get('kis-call', null), set: (v) => ls.set('kis-call', v) };

  const api = async (path, opt = {}) => {
    const res = await fetch(path, Object.assign({ cache: 'no-store' }, opt, { headers: { 'content-type': 'application/json' } }));
    let data = {};
    try { data = await res.json(); } catch (e) { /* 본문 없음 */ }
    if (!res.ok) { const err = new Error(L.lang === 'ko' && data.error ? data.error : t('netFail')); err.status = res.status; throw err; }
    return data;
  };

  /* ── 장소 ── */
  const callable = D.rooms().filter((r) => r.searchable && !['restroom', 'elev'].includes(r.cat));
  const GROUPS = [['class', 'classroom'], ['office', 'office'], ['special', 'flask'], ['facility', 'star']];
  const nameOf = (r) => L.roomName(r);
  const sortRooms = (a, b) => (a.group === 'class' && b.group === 'class' ? a.grade - b.grade || a.klass - b.klass : nameOf(a).localeCompare(nameOf(b), L.lang, { numeric: true }));
  const KINDS = [['deliver', 'delivery'], ['bring', 'hand'], ['guide', 'map'], ['other', 'chat']];

  const form = { step: 1, floor: 1, room: null, free: '', query: '', kind: '', note: '', name: ls.get('kis-call-name', ''), pin: '' };
  let info = { ready: true, pinRequired: false };
  let errMsg = '';

  /* ── 머리글 (얼굴 · 인사 · 언어 바꾸기) ── */
  function renderTop(mode, call) {
    const top = $('#c-top');
    const st = call ? (t('st')[call.status] || t('st').waiting) : null;
    top.className = `c-top ${call ? `is-status st-${call.status}` : ''}`;
    top.innerHTML = `
      <div class="c-bar">
        <div class="c-brand"><b>${esc(t('appTitle'))}</b><span>${esc(t('appSub'))}</span></div>
        <button class="c-lang" type="button" data-act="lang" aria-label="${esc(t('langLabel'))}">${I('chat')}${esc(t('langBtn'))}</button>
      </div>
      <div class="c-hero">
        <div class="c-face" id="c-face"></div>
        <div class="c-hero-text">
          <h1>${esc(call ? st[0] : t('heroHi'))}</h1>
          <p>${esc(call ? (call.status === 'waiting' && call.ahead > 0 ? t('ahead')(call.ahead) : st[1]) : t('heroText'))}</p>
        </div>
      </div>
      ${mode === 'form' ? `<ol class="c-stepper">${[t('stepWhere'), t('stepWhat'), t('stepCheck')].map((s, i) => `<li class="${i + 1 < form.step ? 'is-done' : i + 1 === form.step ? 'is-now' : ''}"><span>${i + 1 < form.step ? I('check') : i + 1}</span>${esc(s)}</li>`).join('')}</ol>` : ''}`;
    const face = KIS.createFace($('#c-face'), { mini: true });
    if (call && (call.status === 'arrived' || call.status === 'done')) face.react('happy', 4000);
    document.title = t('appTitle');
  }

  /* ───────── 호출하기 ───────── */
  const picked = () => form.room || form.free;

  function renderForm() {
    renderTop('form');
    const body = form.step === 1 ? stepWhere() : form.step === 2 ? stepWhat() : stepCheck();
    main.innerHTML = `${body}
      ${errMsg ? `<p class="c-error" role="alert">${esc(errMsg)}</p>` : ''}
      ${!info.ready ? `<p class="c-error">${esc(t('notReady'))}</p>` : ''}
      <div class="c-actions">
        ${form.step > 1 ? `<button class="c-btn c-btn-ghost" type="button" data-act="prev">${I('back')}${esc(t('back'))}</button>` : ''}
        ${form.step < 3
          ? `<button class="c-btn c-btn-main" type="button" data-act="next" ${form.step === 1 && !picked() ? 'disabled' : ''}>${esc(t('next'))}${I('chevron')}</button>`
          : `<button class="c-btn c-btn-main c-btn-send" type="button" data-act="send">${I('delivery')}${esc(t('send'))}</button>`}
      </div>`;
    errMsg = '';
    if (form.step === 1) renderRooms();
  }

  function placeCard(changeAct) {
    const r = form.room;
    return `<div class="c-place">
      <span class="c-badge cat-${r ? r.cat : 'free'}">${r ? `<b>${r.floor}</b><small>${esc(t('floorShort'))}</small>` : I('pin')}</span>
      <div><b>${esc(r ? nameOf(r) : form.free)}</b><span>${esc(r ? t('floor')(r.floor) : t('typedPlace'))}</span></div>
      ${changeAct ? `<button type="button" class="c-chip-btn" data-act="${changeAct}">${esc(t('change'))}</button>` : ''}
    </div>`;
  }

  function stepWhere() {
    const recent = ls.get('kis-call-recent', []).map((x) => (x.id ? D.roomById(x.id) : x.free ? x : null)).filter(Boolean).slice(0, 4);
    return `<section class="c-card">
      <header class="c-head"><h2>${esc(t('whereTitle'))}</h2><p>${esc(t('whereSub'))}</p></header>
      ${picked() ? placeCard('repick') : `
      <label class="c-search">${I('search')}<input id="c-q" type="search" placeholder="${esc(t('searchPh'))}" autocomplete="off" enterkeyhint="search" value="${esc(form.query)}"></label>
      ${recent.length ? `<div class="c-recent"><span>${esc(t('recent'))}</span><div>${recent.map((r) => (r.id
        ? `<button type="button" data-room="${esc(r.id)}">${I('star')}${esc(nameOf(r))}</button>`
        : `<button type="button" data-free="${esc(r.free)}">${I('pin')}${esc(r.free)}</button>`)).join('')}</div></div>` : ''}
      <div class="c-floors" id="c-floors">${D.floors.map((f) => `<button type="button" data-floor="${f.id}"><b>${f.id}</b>${esc(t('floorShort'))}</button>`).join('')}</div>
      <div class="c-rooms" id="c-rooms"></div>`}
    </section>`;
  }

  const roomBtn = (r, showFloor) => `<button type="button" class="c-room cat-${r.cat}" data-room="${esc(r.id)}">
    <i></i><span>${esc(nameOf(r))}</span>${showFloor ? `<small>${esc(t('floor')(r.floor))}</small>` : ''}</button>`;

  function renderRooms() {
    const host = $('#c-rooms');
    if (!host) return;
    const q = form.query.trim();
    document.querySelectorAll('#c-floors button').forEach((b) => b.classList.toggle('is-on', !q && Number(b.dataset.floor) === form.floor));
    if (q) {
      const ql = q.toLowerCase();
      const hits = S.search(q, { limit: 30 }).filter((h) => h.room && callable.includes(h.room)).map((h) => h.room);
      callable.forEach((r) => { if (!hits.includes(r) && L.enName(r).toLowerCase().includes(ql)) hits.push(r); });
      host.innerHTML = `<div class="c-list">${hits.slice(0, 30).map((r) => roomBtn(r, true)).join('')}</div>
        ${hits.length ? '' : `<p class="c-none">${esc(t('noRooms'))}</p>`}
        <button type="button" class="c-free" data-act="free">${I('pin')}<span>${esc(t('useTyped')(q))}</span></button>`;
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
      <textarea id="c-note" maxlength="120" rows="3" placeholder="${esc(t('notePh'))}">${esc(form.note)}</textarea>
      <div class="c-count"><span id="c-count">${form.note.length}</span>/120</div>
    </section>`;
  }

  function stepCheck() {
    const kind = form.kind ? t('kinds')[form.kind][0] : '';
    return `<section class="c-card">
      <header class="c-head"><h2>${esc(t('checkTitle'))}</h2><p>${esc(t('checkSub'))}</p></header>
      <dl class="c-sum">
        <div><dt>${esc(t('to'))}</dt><dd>${placeCard('edit1')}</dd></div>
        ${kind || form.note ? `<div><dt>${esc(t('request'))}</dt><dd class="c-req">
          <div>${kind ? `<span class="c-tag">${esc(kind)}</span>` : ''}${form.note ? `<p>${esc(form.note)}</p>` : ''}</div>
          <button type="button" class="c-chip-btn" data-act="edit2">${esc(t('change'))}</button></dd></div>` : ''}
      </dl>
      <label class="c-field"><span>${esc(t('name'))}</span>
        <input id="c-name" maxlength="20" placeholder="${esc(t('namePh'))}" value="${esc(form.name)}" autocomplete="name"></label>
      ${info.pinRequired ? `<label class="c-field"><span>${esc(t('pin'))}</span>
        <input id="c-pin" inputmode="numeric" maxlength="12" placeholder="${esc(t('pinPh'))}" value="${esc(form.pin)}" autocomplete="off"></label>` : ''}
    </section>`;
  }

  function go(step) { form.step = step; renderForm(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

  main.addEventListener('input', (e) => {
    const id = e.target.id;
    if (id === 'c-q') { form.query = e.target.value; renderRooms(); }
    if (id === 'c-note') { form.note = e.target.value; $('#c-count').textContent = form.note.length; }
    if (id === 'c-name') form.name = e.target.value;
    if (id === 'c-pin') form.pin = e.target.value;
  });
  main.addEventListener('keydown', (e) => { if (e.target.id === 'c-q' && e.key === 'Enter') e.target.blur(); });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.floor) { form.floor = Number(d.floor); form.query = ''; const qi = $('#c-q'); if (qi) qi.value = ''; renderRooms(); return; }
    if (d.room) { form.room = D.roomById(d.room); form.free = ''; go(2); return; }
    if (d.free) { form.free = d.free; form.room = null; go(2); return; }
    if (d.kind) {
      form.kind = form.kind === d.kind ? '' : d.kind;
      document.querySelectorAll('.c-kind').forEach((k) => { const on = k.dataset.kind === form.kind; k.classList.toggle('is-on', on); k.setAttribute('aria-pressed', on); });
      if (form.kind === 'other') $('#c-note').focus();
      return;
    }
    switch (d.act) {
      case 'lang': L.set(L.lang === 'ko' ? 'en' : 'ko'); rerender(); break;
      case 'free': form.free = form.query.trim().slice(0, 40); form.room = null; go(2); break;
      case 'repick': form.room = null; form.free = ''; renderForm(); break;
      case 'edit1': form.room = null; form.free = ''; go(1); break;
      case 'edit2': go(2); break;
      case 'prev': go(form.step - 1); break;
      case 'next': if (form.step === 1 && !picked()) { errMsg = t('needPlace'); renderForm(); } else go(form.step + 1); break;
      case 'send': send(b); break;
      case 'cancel': cancel(b); break;
      case 'again':
        mine.set(null); stopPoll(); lastCall = null;
        Object.assign(form, { step: 1, room: null, free: '', query: '', kind: '', note: '' });
        renderForm(); window.scrollTo(0, 0); break;
      case 'retry': refresh().then(() => { if (mine.get() && !pollT) startPoll(); }); break;
      default:
    }
  });

  async function send(btn) {
    if (!picked()) { errMsg = t('needPlace'); go(1); return; }
    if (info.pinRequired && !form.pin.trim()) { errMsg = t('needPin'); renderForm(); return; }
    btn.disabled = true;
    btn.innerHTML = `<i class="c-spin"></i>${esc(t('sending'))}`;
    const body = form.room ? { roomId: form.room.id, place: RT.displayName(form.room), floor: form.room.floor } : { place: form.free };
    Object.assign(body, { kind: form.kind, note: form.note.trim(), name: form.name.trim(), pin: form.pin.trim(), lang: L.lang });
    try {
      const data = await api('/api/calls', { method: 'POST', body: JSON.stringify(body) });
      mine.set({ id: data.call.id, token: data.token });
      ls.set('kis-call-name', form.name.trim());
      const rec = ls.get('kis-call-recent', []).filter((x) => (form.room ? x.id !== form.room.id : x.free !== form.free));
      rec.unshift(form.room ? { id: form.room.id } : { free: form.free });
      ls.set('kis-call-recent', rec.slice(0, 6));
      renderStatus(data.call);
      startPoll();
      window.scrollTo(0, 0);
    } catch (e) {
      errMsg = e.message || t('netFail');
      renderForm();
    }
  }

  /* ───────── 호출 상태 ───────── */
  let lastCall = null;
  function renderStatus(call) {
    lastCall = call;
    renderTop('status', call);
    const order = ['waiting', 'accepted', 'arrived'];
    const idx = Math.max(0, order.indexOf(call.status));
    const finished = call.status === 'done' || call.status === 'canceled';
    const room = call.roomId && D.roomById(call.roomId);
    const kind = call.kind && t('kinds')[call.kind] ? t('kinds')[call.kind][0] : '';
    const time = new Date(call.createdAt).toLocaleTimeString(L.lang === 'ko' ? 'ko-KR' : 'en-US', { hour: 'numeric', minute: '2-digit' });
    const route = room && !finished && call.status !== 'arrived' ? RT.route(CFG.robotLocation, room, { mode: 'elevator' }) : null;
    const dotIcon = ['bell', 'delivery', 'arrive'];

    main.innerHTML = `
      ${finished ? '' : `<section class="c-card c-track">
        <div class="c-progress"><i style="width:${[14, 58, 100][idx]}%"></i></div>
        <ol class="c-timeline">${t('steps').map(([title, sub], i) => `<li class="${i < idx || (i === idx && call.status === 'arrived') ? 'is-done' : i === idx ? 'is-now' : ''}">
          <span class="c-dot">${i < idx || (i === idx && call.status === 'arrived') ? I('check') : I(dotIcon[i])}</span>
          <div><b>${esc(title)}</b><small>${esc(sub)}</small></div></li>`).join('')}</ol>
        <p class="c-live"><i></i>${esc(t('liveNote'))}</p>
      </section>`}
      <section class="c-card">
        <div class="c-place">
          <span class="c-badge cat-${room ? room.cat : 'free'}">${call.floor ? `<b>${call.floor}</b><small>${esc(t('floorShort'))}</small>` : I('pin')}</span>
          <div><b>${esc(room ? nameOf(room) : call.place)}</b><span>${esc(t('calledAt')(time))}</span></div>
        </div>
        ${kind || call.note ? `<div class="c-req c-req-box"><div>${kind ? `<span class="c-tag">${esc(kind)}</span>` : ''}${call.note ? `<p>${esc(call.note)}</p>` : ''}</div></div>` : ''}
      </section>
      ${route ? `<section class="c-card c-route">
        <header class="c-route-head"><h2>${I('map')}${esc(t('routeTitle'))}</h2><span>${esc(t('routeMeta')(RT.fmtMeters(route.meters), Math.max(1, Math.round(route.seconds / 60))))}</span></header>
        <div class="c-map" id="c-map"></div>
      </section>` : ''}
      <p class="c-error" id="c-net" hidden></p>
      <div class="c-actions is-static">
        ${call.status === 'waiting' ? `<button class="c-btn c-btn-danger" data-act="cancel" type="button">${I('close')}${esc(t('cancel'))}</button>` : ''}
        ${finished ? `<button class="c-btn c-btn-main" data-act="again" type="button">${I('delivery')}${esc(t('again'))}</button>` : ''}
      </div>`;
    if (route) drawRoute(route, room);
    if (finished) { stopPoll(); mine.set(null); }
  }

  function drawRoute(r, room) {
    requestAnimationFrame(() => {
      const host = $('#c-map');
      if (!host) return;
      const segs = r.segments, seg = segs[segs.length - 1], multi = segs.length > 1;
      const mv = new KIS.MapView(host, {});
      mv.setFloor(seg.floor);
      const prev = multi ? segs[segs.length - 2].floor : null;
      const youLabel = multi ? (L.lang === 'ko' ? `${prev}층에서 와요` : `From floor ${prev}`) : t('robotHere');
      mv.showRoute(seg, { isFirst: true, room, youLabel });
      const c = RT.roomCenter(room);
      mv.pill(c[0], c[1] - 27, nameOf(room), 'pill-go');
      const pts = seg.draw.slice();
      room.rects.forEach((rc) => pts.push([rc[0], rc[1]], [rc[2], rc[3]]));
      pts.push([c[0], c[1] - 34]);
      mv.fit(pts, 30, 200);
    });
  }

  let pollT = null;
  function startPoll() { stopPoll(); pollT = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS); }
  function stopPoll() { clearInterval(pollT); pollT = null; }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && pollT) refresh(); });

  async function refresh() {
    const m = mine.get();
    if (!m) return;
    try {
      const data = await api(`/api/calls/${encodeURIComponent(m.id)}?t=${encodeURIComponent(m.token)}`);
      const c = data.call;
      if (!lastCall || c.status !== lastCall.status || c.ahead !== lastCall.ahead) {
        if (lastCall && c.status !== lastCall.status && navigator.vibrate) navigator.vibrate([120, 80, 120]);
        renderStatus(c);
      }
      const net = $('#c-net'); if (net) net.hidden = true;
    } catch (e) {
      if (e.status === 404) { mine.set(null); stopPoll(); lastCall = null; errMsg = t('lost'); renderForm(); return; }
      const net = $('#c-net');
      if (net) { net.hidden = false; net.textContent = t('offline'); }
      else {
        main.innerHTML = `<section class="c-card c-empty"><h2>${esc(t('offlineTitle'))}</h2><p>${esc(t('offlineText'))}</p>
          <button class="c-btn c-btn-main" data-act="retry" type="button">${I('refresh')}${esc(t('retry'))}</button></section>`;
      }
    }
  }

  async function cancel(btn) {
    const m = mine.get();
    if (!m) return;
    btn.disabled = true;
    try {
      const data = await api(`/api/calls/${encodeURIComponent(m.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'canceled', t: m.token }) });
      renderStatus(data.call);
    } catch (e) {
      btn.disabled = false;
      const net = $('#c-net'); if (net) { net.hidden = false; net.textContent = e.message; }
      refresh();
    }
  }

  function rerender() {
    $('#c-foot').textContent = t('footer');
    if (lastCall) renderStatus(lastCall);
    else if (mine.get()) refresh();
    else renderForm();
  }

  /* ───────── 시작 ───────── */
  (async function start() {
    L.set(L.lang);
    $('#c-foot').textContent = t('footer');
    try { info = await api('/api/info'); } catch (e) { info = { ready: false, pinRequired: false }; }
    if (mine.get()) {
      renderTop('status', { status: 'waiting', ahead: 0 });
      main.innerHTML = `<section class="c-card c-empty"><i class="c-spin"></i><p>${esc(t('loading'))}</p></section>`;
      await refresh();
      if (mine.get()) startPoll();
    } else renderForm();
  })();
})();
