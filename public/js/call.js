/* 배달 호출 화면 (call.html) — 세로 휴대폰 기준
 *   1) 장소 고르기(층별 목록 · 검색) → 요청 내용 → 호출하기
 *   2) 호출 상태 보기: 접수 → 로봇 출발 → 도착 (몇 초마다 새로 확인)
 *   지금 진행 중인 호출은 이 기기에 저장되어, 페이지를 닫았다 열어도 상태가 이어집니다.
 */
(function () {
  const D = KIS.DATA, RT = KIS.Router, S = KIS.Search, I = KIS.icon;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const main = $('#c-main');
  const POLL_MS = 4000;

  KIS.createFace($('#m-avatar'), { mini: true });

  const SKEY = 'kis-call';
  const mine = {
    get() { try { return JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (e) { return null; } },
    set(v) { try { v ? localStorage.setItem(SKEY, JSON.stringify(v)) : localStorage.removeItem(SKEY); } catch (e) { /* 저장 불가 */ } },
  };

  const api = async (path, opt = {}) => {
    const res = await fetch(path, Object.assign({ cache: 'no-store' }, opt, {
      headers: Object.assign({ 'content-type': 'application/json' }, opt.headers || {}),
    }));
    let data = {};
    try { data = await res.json(); } catch (e) { /* 본문 없음 */ }
    if (!res.ok) { const err = new Error(data.error || `서버 응답 ${res.status}`); err.status = res.status; throw err; }
    return data;
  };

  const placeName = (r) => RT.displayName(r);
  const callable = D.rooms().filter((r) => r.searchable && !['restroom', 'elev'].includes(r.cat));
  const QUICK = ['서류 배달', '물건 가져가 주세요', '물건 가져다 주세요', '안내가 필요해요'];

  const form = { floor: 1, room: null, query: '', free: '', note: '', name: '', pin: '' };
  let info = { ready: true, pinRequired: false };

  /* ───────── 1) 호출하기 ───────── */
  function renderForm(msg = '') {
    main.innerHTML = `
      <section class="m-card c-sec">
        <h2 class="c-h"><span class="c-num">1</span>어디로 갈까요?</h2>
        <div id="c-picked"></div>
        <div id="c-picker">
          <label class="c-search">${I('search')}<input id="c-q" type="search" placeholder="장소 검색 (예: 보건실, 5-1)" autocomplete="off" enterkeyhint="search" value="${esc(form.query)}"></label>
          <div class="c-floors" role="tablist">${D.floors.map((f) => `<button type="button" role="tab" data-floor="${f.id}" class="${f.id === form.floor ? 'is-on' : ''}">${f.id}층</button>`).join('')}</div>
          <div class="c-rooms" id="c-rooms"></div>
        </div>
      </section>
      <section class="m-card c-sec">
        <h2 class="c-h"><span class="c-num">2</span>무엇을 도와줄까요? <small>선택</small></h2>
        <div class="c-chips">${QUICK.map((q) => `<button type="button" data-quick="${esc(q)}">${esc(q)}</button>`).join('')}</div>
        <textarea id="c-note" maxlength="120" rows="2" placeholder="예: 교무실에 서류 전달해 주세요">${esc(form.note)}</textarea>
        <input id="c-name" class="c-input" maxlength="20" placeholder="호출하는 사람 (예: 5-1 담임)" value="${esc(form.name)}" autocomplete="name">
        ${info.pinRequired ? `<input id="c-pin" class="c-input" inputmode="numeric" maxlength="12" placeholder="학교 코드" value="${esc(form.pin)}" autocomplete="off">` : ''}
      </section>
      ${msg ? `<p class="c-error" role="alert">${esc(msg)}</p>` : ''}
      ${!info.ready ? '<p class="c-error">호출 서버가 아직 준비되지 않았어요. 관리자에게 알려 주세요.</p>' : ''}
      <div class="c-submit-bar"><button class="m-btn" id="c-send" type="button">${I('delivery')}피콕 호출하기</button></div>`;
    renderPicked();
    renderRooms();
  }

  function renderPicked() {
    const box = $('#c-picked'), picker = $('#c-picker');
    const chosen = form.room ? { name: placeName(form.room), floor: form.room.floor, cat: form.room.cat } : form.free ? { name: form.free, floor: null, cat: 'admin' } : null;
    picker.hidden = !!chosen;
    box.innerHTML = chosen ? `<div class="c-picked">
      <span class="m-badge cat-${chosen.cat}">${chosen.floor ? `<b>${chosen.floor}</b>층` : I('pin')}</span>
      <div><b>${esc(chosen.name)}</b><span>${chosen.floor ? `${chosen.floor}층` : '직접 입력한 장소'}</span></div>
      <button type="button" class="c-link" data-act="repick">바꾸기</button></div>` : '';
  }

  function renderRooms() {
    const host = $('#c-rooms');
    if (!host) return;
    const q = form.query.trim();
    let rooms;
    if (q) rooms = S.search(q, { limit: 30 }).filter((h) => h.room && callable.includes(h.room)).map((h) => h.room);
    else rooms = callable.filter((r) => r.floor === form.floor).sort((a, b) => placeName(a).localeCompare(placeName(b), 'ko', { numeric: true }));
    document.querySelectorAll('.c-floors button').forEach((b) => b.classList.toggle('is-on', !q && Number(b.dataset.floor) === form.floor));
    host.innerHTML = rooms.map((r) => `<button type="button" class="c-room cat-${r.cat}" data-room="${esc(r.id)}">
        <i></i><span>${esc(placeName(r))}</span>${q ? `<small>${r.floor}층</small>` : ''}</button>`).join('')
      + (q ? `<button type="button" class="c-room c-free" data-act="free">${I('pin')}<span>“${esc(q)}”(으)로 호출하기</span></button>` : '')
      + (!rooms.length && !q ? '<p class="c-none">이 층에는 고를 장소가 없어요.</p>' : '');
  }

  main.addEventListener('input', (e) => {
    if (e.target.id === 'c-q') { form.query = e.target.value; renderRooms(); }
    if (e.target.id === 'c-note') form.note = e.target.value;
    if (e.target.id === 'c-name') form.name = e.target.value;
    if (e.target.id === 'c-pin') form.pin = e.target.value;
  });

  main.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.floor) { form.floor = Number(t.dataset.floor); form.query = ''; $('#c-q').value = ''; renderRooms(); return; }
    if (t.dataset.room) { form.room = D.roomById(t.dataset.room); form.free = ''; renderPicked(); return; }
    if (t.dataset.quick) {
      const n = $('#c-note');
      form.note = n.value.includes(t.dataset.quick) ? n.value : (n.value ? `${n.value.trim()} ${t.dataset.quick}` : t.dataset.quick).slice(0, 120);
      n.value = form.note;
      return;
    }
    const act = t.dataset.act || t.id;
    if (act === 'free') { form.free = form.query.trim().slice(0, 40); form.room = null; renderPicked(); }
    if (act === 'repick') { form.room = null; form.free = ''; renderPicked(); renderRooms(); }
    if (act === 'c-send') send(t);
    if (act === 'cancel') cancel(t);
    if (act === 'again') { mine.set(null); stopPoll(); form.room = null; form.free = ''; form.note = ''; renderForm(); window.scrollTo(0, 0); }
    if (act === 'retry') refresh().then(() => { if (mine.get() && !pollT) startPoll(); });
  });

  async function send(btn) {
    if (!form.room && !form.free) { renderForm('먼저 피콕이 갈 장소를 골라 주세요.'); return; }
    if (info.pinRequired && !form.pin.trim()) { renderForm('학교 코드를 넣어 주세요.'); return; }
    btn.disabled = true;
    btn.textContent = '호출하는 중…';
    try {
      const body = form.room
        ? { roomId: form.room.id, place: placeName(form.room), floor: form.room.floor }
        : { place: form.free };
      Object.assign(body, { note: form.note.trim(), name: form.name.trim(), pin: form.pin.trim() });
      const data = await api('/api/calls', { method: 'POST', body: JSON.stringify(body) });
      mine.set({ id: data.call.id, token: data.token });
      try { localStorage.setItem('kis-call-name', form.name.trim()); } catch (e) { /* 저장 불가 */ }
      renderStatus(data.call);
      startPoll();
      window.scrollTo(0, 0);
    } catch (e) {
      renderForm(e.message || '호출하지 못했어요. 인터넷 연결을 확인해 주세요.');
    }
  }

  /* ───────── 2) 호출 상태 ───────── */
  const STEPS = [
    { st: 'waiting', title: '호출 접수', text: '피콕에게 호출이 전달됐어요' },
    { st: 'accepted', title: '피콕 출발', text: '피콕이 가고 있어요' },
    { st: 'arrived', title: '도착', text: '피콕이 도착했어요' },
  ];
  const HEAD = {
    waiting: ['호출했어요', '피콕이 곧 출발해요. 이 화면을 열어 두면 상태가 바뀌어요.'],
    accepted: ['피콕이 가고 있어요', '조금만 기다려 주세요.'],
    arrived: ['피콕이 도착했어요!', '피콕을 찾아 주세요.'],
    done: ['배달이 끝났어요', '이용해 주셔서 고마워요.'],
    canceled: ['호출이 취소됐어요', ''],
  };

  function renderStatus(call) {
    const idx = Math.max(0, STEPS.findIndex((s) => s.st === call.status));
    const finished = call.status === 'done' || call.status === 'canceled';
    const room = call.roomId && D.roomById(call.roomId);
    const [h, sub] = HEAD[call.status] || HEAD.waiting;
    const extra = call.status === 'waiting' && call.ahead > 0 ? `앞에 기다리는 호출이 ${call.ahead}건 있어요.` : sub;
    main.innerHTML = `
      <section class="m-card c-status st-${call.status}">
        <div class="c-status-face" id="c-face"></div>
        <h1>${esc(h)}</h1>
        ${extra ? `<p>${esc(extra)}</p>` : ''}
        ${finished ? '' : `<ol class="c-steps">${STEPS.map((s, i) => `<li class="${i < idx ? 'is-done' : i === idx ? 'is-now' : ''}">
          <span class="c-dot">${i < idx ? I('check') : i + 1}</span><div><b>${s.title}</b><span>${s.text}</span></div></li>`).join('')}</ol>`}
      </section>
      <section class="m-card c-sum">
        <div class="c-picked">
          <span class="m-badge cat-${room ? room.cat : 'admin'}">${call.floor ? `<b>${call.floor}</b>층` : I('pin')}</span>
          <div><b>${esc(call.place)}</b><span>${call.floor ? `${call.floor}층` : '직접 입력한 장소'} · ${new Date(call.createdAt).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })} 호출</span></div>
        </div>
        ${call.note ? `<p class="c-sum-note">${esc(call.note)}</p>` : ''}
      </section>
      <p class="c-error" id="c-net" hidden></p>
      <div class="c-submit-bar">
        ${call.status === 'waiting' ? '<button class="m-btn c-btn-line" data-act="cancel" type="button">호출 취소</button>' : ''}
        ${finished ? `<button class="m-btn" data-act="again" type="button">${I('delivery')}새로 호출하기</button>` : ''}
      </div>`;
    const face = KIS.createFace($('#c-face'), { mini: true });
    if (call.status === 'arrived' || call.status === 'done') face.react && face.react('happy', 3000);
    if (finished) { stopPoll(); mine.set(null); }
  }

  let pollT = null;
  function startPoll() { stopPoll(); pollT = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS); }
  function stopPoll() { clearInterval(pollT); pollT = null; }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && pollT) refresh(); });

  let last = '';
  async function refresh() {
    const m = mine.get();
    if (!m) return;
    try {
      const data = await api(`/api/calls/${encodeURIComponent(m.id)}?t=${encodeURIComponent(m.token)}`);
      const key = `${data.call.status}/${data.call.ahead}`;
      if (key !== last) {
        if (last && data.call.status !== last.split('/')[0] && navigator.vibrate) navigator.vibrate([120, 80, 120]);
        last = key;
        renderStatus(data.call);
      }
      const net = $('#c-net'); if (net) net.hidden = true;
    } catch (e) {
      if (e.status === 404) { mine.set(null); stopPoll(); renderForm('지난 호출을 찾지 못했어요. 새로 호출해 주세요.'); return; }
      const net = $('#c-net');
      if (net) { net.hidden = false; net.textContent = '연결이 잠시 끊겼어요. 다시 확인하는 중…'; }
      else main.innerHTML = `<section class="m-card m-empty"><h1>연결이 끊겼어요</h1><p>인터넷 연결을 확인해 주세요.</p><button class="m-btn" data-act="retry" type="button" style="margin-top:14px">${I('refresh')}다시 확인</button></section>`;
    }
  }

  async function cancel(btn) {
    const m = mine.get();
    if (!m) return;
    btn.disabled = true;
    try {
      const data = await api(`/api/calls/${encodeURIComponent(m.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'canceled', t: m.token }) });
      last = '';
      renderStatus(data.call);
    } catch (e) {
      btn.disabled = false;
      const net = $('#c-net'); if (net) { net.hidden = false; net.textContent = e.message; }
      refresh();
    }
  }

  /* ───────── 시작 ───────── */
  (async function start() {
    try { form.name = localStorage.getItem('kis-call-name') || ''; } catch (e) { /* 없음 */ }
    try { info = await api('/api/info'); } catch (e) { info = { ready: false, pinRequired: false }; }
    if (mine.get()) {
      main.innerHTML = '<section class="m-card m-empty"><p>호출 상태를 불러오는 중…</p></section>';
      await refresh();
      if (mine.get()) startPoll();
    } else renderForm();
  })();
})();
