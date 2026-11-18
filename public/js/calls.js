/* 로봇 화면: 배달 호출 알림
 *   몇 초마다 /api/calls 를 확인해서 새 호출이 오면 알림음 + 음성 + 호출 카드를 띄웁니다.
 *   운영하는 분이 카드에서 "출발" → "도착" → "완료" 를 누르면 호출한 사람 화면에도 상태가 바뀝니다.
 *   로봇으로 등록된 기기(js/device.js)에서만 동작합니다.
 */
(function () {
  if (!KIS.Device || !KIS.Device.isRobot) return;
  const D = KIS.DATA, RT = KIS.Router, I = KIS.icon;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = () => KIS.app;

  const POLL_MS = 5000;
  const REMIND_MS = 120000;     // 아무도 출발을 누르지 않으면 2분마다 다시 알림
  const box = $('#calls');
  const btn = $('#btn-calls');
  let calls = [];
  let seen = null;              // 처음 불러온 목록은 "새 호출"로 울리지 않는다
  let offline = false;
  let lastRemind = 0;
  let busy = false;

  const KIND = { deliver: '전달', bring: '가져오기', guide: '길 안내', other: '기타' };
  const LABEL = { waiting: '새 호출', accepted: '가는 중', arrived: '도착' };
  const since = (t) => {
    const m = Math.floor((Date.now() - t) / 60000);
    return m < 1 ? '방금' : m < 60 ? `${m}분 전` : `${Math.floor(m / 60)}시간 전`;
  };
  const floorOf = (c) => {
    const r = c.roomId && D.roomById(c.roomId);
    return r ? r.floor : c.floor;
  };

  /* ── 알림음 (파일 없이 Web Audio 로 '딩동') ── */
  let actx;
  function chime() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      [[880, 0], [660, 0.28]].forEach(([f, t]) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, actx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.35, actx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + t + 0.6);
        o.connect(g).connect(actx.destination);
        o.start(actx.currentTime + t); o.stop(actx.currentTime + t + 0.65);
      });
    } catch (e) { /* 소리 불가 */ }
  }

  function placeText(c) {
    const f = floorOf(c);
    const r = c.roomId && D.roomById(c.roomId);
    const name = r ? RT.displayName(r) : c.place;
    return f && !String(name).startsWith(`${f}층`) ? `${f}층 ${name}` : name;
  }

  /* ── 불러오기 ── */
  async function poll() {
    try {
      const res = await fetch('/api/calls', { headers: KIS.Device.apiHeaders(), cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      offline = false;
      update(data.calls || []);
    } catch (e) {
      offline = true;
      renderBtn();
    }
  }

  function update(list) {
    const fresh = seen ? list.filter((c) => c.status === 'waiting' && !seen.has(c.id)) : [];
    seen = new Set(list.map((c) => c.id));
    calls = list.sort((a, b) => a.createdAt - b.createdAt);
    renderBtn();
    if (!box.hidden) render();
    if (fresh.length) alertNew(fresh[fresh.length - 1]);
    else if (calls.some((c) => c.status === 'waiting') && Date.now() - lastRemind > REMIND_MS && box.hidden) alertNew(null);
  }

  function alertNew(c) {
    lastRemind = Date.now();
    chime();
    const a = app();
    const open = () => {
      show();
      const line = c ? `${placeText(c)}에서 배달 호출이 왔어요.` : `기다리는 배달 호출이 ${calls.filter((x) => x.status === 'waiting').length}건 있어요.`;
      a.say(line);
    };
    if (!a.isAwake()) { a.wake(); setTimeout(open, 1600); } else open();
  }

  /* ── 상단 버튼 ── */
  function renderBtn() {
    const n = calls.length;
    const waiting = calls.filter((c) => c.status === 'waiting').length;
    btn.hidden = !n && !offline;
    btn.classList.toggle('is-alert', waiting > 0);
    btn.classList.toggle('is-off', offline);
    btn.innerHTML = offline ? `${I('delivery')}<span>호출 연결 끊김</span>` : `${I('delivery')}<span>호출</span><b>${n}</b>`;
  }
  btn.addEventListener('click', () => (box.hidden ? show() : hide()));

  /* ── 호출 목록 ── */
  function show() { box.hidden = false; render(); app().resetIdle(); }
  function hide() { box.hidden = true; box.innerHTML = ''; }

  function render() {
    box.innerHTML = `<div class="calls-card" role="dialog" aria-modal="true" aria-label="배달 호출">
      <div class="calls-head">
        <h2>${I('delivery')}배달 호출 <span>${calls.length}건</span></h2>
        <button class="sheet-close" data-call="close" aria-label="닫기">${I('close')}</button>
      </div>
      <div class="calls-list">
        ${calls.length ? calls.map((c) => {
          const f = floorOf(c);
          return `<article class="call-item st-${c.status}">
            <div class="call-floor">${f ? `<b>${f}</b>층` : I('pin')}</div>
            <div class="call-body">
              <div class="call-top"><span class="call-st">${LABEL[c.status] || c.status}</span>${KIND[c.kind] ? `<span class="call-kind">${KIND[c.kind]}</span>` : ''}${c.lang === 'en' ? '<span class="call-kind">English</span>' : ''}<span class="call-time">${since(c.createdAt)}</span></div>
              <h3>${esc(placeText(c))}</h3>
              ${c.note ? `<p class="call-note">${esc(c.note)}</p>` : ''}
              ${c.name ? `<p class="call-name">호출한 사람: ${esc(c.name)}</p>` : ''}
            </div>
            <div class="call-acts">
              ${c.roomId && D.roomById(c.roomId) ? `<button class="btn" data-call="route" data-id="${c.id}">${I('map')}길 보기</button>` : ''}
              ${c.status === 'waiting' ? `<button class="btn btn-primary" data-call="accepted" data-id="${c.id}">${I('delivery')}출발</button>` : ''}
              ${c.status === 'accepted' ? `<button class="btn btn-primary" data-call="arrived" data-id="${c.id}">${I('arrive')}도착</button>` : ''}
              ${c.status === 'arrived' ? `<button class="btn btn-primary" data-call="done" data-id="${c.id}">${I('check')}완료</button>` : ''}
              <button class="btn btn-ghost" data-call="canceled" data-id="${c.id}">취소</button>
            </div>
          </article>`;
        }).join('') : `<p class="calls-empty">기다리는 호출이 없어요.</p>`}
      </div>
    </div>`;
  }

  async function setStatus(id, status) {
    if (busy) return;
    busy = true;
    try {
      const res = await fetch(`/api/calls/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: Object.assign({ 'content-type': 'application/json' }, KIS.Device.apiHeaders()),
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(res.status);
    } catch (e) {
      app().bubble('호출 상태를 바꾸지 못했어요. 인터넷 연결을 확인해 주세요.', false);
    }
    busy = false;
    await poll();
  }

  box.addEventListener('click', (e) => {
    if (e.target === box) { hide(); return; }
    const t = e.target.closest('[data-call]');
    if (!t) return;
    const a = t.dataset.call, id = t.dataset.id;
    if (a === 'close') hide();
    else if (a === 'route') {
      const c = calls.find((x) => x.id === id);
      hide();
      if (c) app().startRoute(c.roomId);
    } else setStatus(id, a);
  });

  KIS.Calls = { hide, show, poll };
  poll();
  setInterval(() => { if (document.visibilityState === 'visible') poll(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
})();
