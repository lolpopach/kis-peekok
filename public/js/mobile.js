/* 휴대폰용 길 안내 (m.html)
 * 로봇 화면의 QR 코드에 담긴 주소로 열린다:  m.html?to=<방 id>&at=<층>,<x>,<y>[&mode=elevator][&k=restroom|elevator]
 * 휴대폰에서도 같은 도면 데이터로 같은 경로를 계산한다 (서버 없음).
 */
(function () {
  const CFG = KIS.CONFIG, D = KIS.DATA, RT = KIS.Router, I = KIS.icon;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const q = new URLSearchParams(location.search);
  const main = $('#m-main');

  KIS.createFace($('#m-avatar'), { mini: true });

  /* ── 주소에서 출발점·목적지 읽기 ── */
  const room = D.roomById(q.get('to') || '');
  let from = Object.assign({}, CFG.robotLocation);
  const at = (q.get('at') || '').split(',').map(Number);
  if (at.length === 3 && D.floorById(at[0]) && at.every((n) => !isNaN(n))) {
    const same = at[0] === from.floor && Math.abs(at[1] - from.x) < 1 && Math.abs(at[2] - from.y) < 1;
    if (!same) {
      const lm = RT.landmark(at[0], [at[1], at[2]], 30);
      from = { floor: at[0], x: at[1], y: at[2], label: `${at[0]}층 ${lm ? `${RT.displayName(lm)} 앞` : '복도'}` };
    }
  }
  const mode = q.get('mode') === 'elevator' ? 'elevator' : 'stairs';
  const kind = q.get('k');

  if (!room) {
    main.innerHTML = `<section class="m-card m-empty">
      <h1>길 정보를 찾지 못했어요</h1>
      <p>로봇 화면에서 QR 코드를 다시 찍어 주세요.</p></section>`;
    return;
  }

  const r = RT.route(from, room, { mode });
  if (!r) {
    main.innerHTML = `<section class="m-card m-empty"><h1>경로를 찾지 못했어요</h1><p>선생님께 문의해 주세요.</p></section>`;
    return;
  }

  /* ── 화면 그리기 ── */
  const title = kind === 'restroom' ? '가장 가까운 화장실' : kind === 'elevator' ? '가장 가까운 엘리베이터' : (room.title || room.name);
  const catLabel = room.cat === 'restroom' ? '화장실' : (D.catNames[room.cat] || '');
  const mins = r.seconds < 50 ? '1분 이내' : `약 ${Math.round(r.seconds / 60)}분`;
  const multi = r.floorsMoved > 0;
  document.title = `${title} 가는 길 · 피콕`;

  // 안내 단계를 층(구간)별로 나눈다: 계단 단계는 출발하는 층에 붙인다
  const segs = r.segments;
  function segIndexForStep(s) {
    if (s.floorChange || s.icon === 'start') {
      const i = segs.findIndex((g) => g.floor === s.floor);
      return i < 0 ? 0 : i;
    }
    for (let i = segs.length - 1; i >= 0; i--) if (segs[i].floor === s.floor) return i;
    return 0;
  }
  const stepsBySeg = segs.map(() => []);
  // 휴대폰에서는 "현재 위치"가 아니라 안내 로봇이 있던 곳에서 출발한다
  r.steps.forEach((s) => { if (s.icon === 'start') s.text = s.text.replace(/^현재 위치\(/, '안내 로봇 앞('); });
  r.steps.forEach((s, i) => stepsBySeg[segIndexForStep(s)].push(Object.assign({ n: i + 1 }, s)));

  const modeUrl = (m) => {
    const u = new URL(location.href);
    if (m === 'stairs') u.searchParams.delete('mode'); else u.searchParams.set('mode', m);
    return u.toString();
  };

  main.innerHTML = `
    <section class="m-card m-dest">
      <div class="m-dest-head">
        <span class="m-badge cat-${room.cat}"><b>${room.floor}</b>층</span>
        <div><h1>${esc(title)}</h1><p>${esc(kind ? `${room.floor}층` : `${catLabel} · ${room.floor}층`)}</p></div>
      </div>
      <div class="m-meta">
        <div><b>${RT.fmtMeters(r.meters)}</b><span>거리</span></div>
        <div><b>${mins}</b><span>걸어서</span></div>
        <div><b>${multi ? `${r.floorsMoved}개 층` : '같은 층'}</b><span>${multi ? (r.usesElevator ? '엘리베이터' : '계단') : '층 이동 없음'}</span></div>
      </div>
      ${multi ? `<div class="m-mode">
        <a class="${mode === 'stairs' ? 'is-on' : ''}" href="${esc(modeUrl('stairs'))}">${I('stairs')}계단으로</a>
        <a class="${mode === 'elevator' ? 'is-on' : ''}" href="${esc(modeUrl('elevator'))}">${I('wheelchair')}엘리베이터로</a>
      </div>` : ''}
      ${r.fallback ? '<p class="m-note">엘리베이터만으로는 갈 수 없어서 계단을 함께 안내해요.</p>' : ''}
      <p class="m-from">${I('start')}출발: 안내 로봇이 있는 <b>${esc(from.label || `${from.floor}층`)}</b></p>
    </section>
    ${segs.map((seg, i) => {
      const role = segs.length === 1 ? '같은 층' : i === 0 ? '출발' : i === segs.length - 1 ? '도착' : '경유';
      const next = seg.via ? `${seg.via.type === 'elev' ? '엘리베이터' : '계단'}으로 ${seg.via.toFloor}층 ${seg.via.toFloor > seg.floor ? '올라가기' : '내려가기'}` : (i === segs.length - 1 ? `${title} 도착` : '');
      return `<section class="m-card m-floor">
        <h2><span class="m-floor-chip">${seg.floor}층</span><span class="m-floor-role">${role}</span><span class="m-floor-next">${esc(next)}</span></h2>
        <div class="m-map" id="m-map-${i}"></div>
        <ol class="m-steps">
          ${stepsBySeg[i].map((s) => `<li class="m-step step-${s.icon}">
            <span class="m-step-ico">${I(s.icon)}</span><span class="m-step-text">${esc(s.text)}</span></li>`).join('')}
        </ol>
      </section>`;
    }).join('')}
    <section class="m-card m-listen">
      <button class="m-btn" id="m-say">${I('sound')}길 안내 소리로 듣기</button>
    </section>`;

  /* ── 층별 고정 지도: 그 층의 경로 부분이 잘 보이게 맞춘다 ── */
  requestAnimationFrame(() => {
    segs.forEach((seg, i) => {
      const mv = new KIS.MapView($(`#m-map-${i}`), {});
      mv.setFloor(seg.floor);
      mv.showRoute(seg, { isFirst: i === 0, prevFloor: i > 0 ? segs[i - 1].floor : null, room, youLabel: '안내 로봇' });
      const pts = seg.draw.slice();
      if (room.floor === seg.floor) room.rects.forEach((rc) => pts.push([rc[0], rc[1]], [rc[2], rc[3]]));
      mv.fit(pts, 30, 210);
    });
  });

  /* ── 소리로 듣기 (휴대폰 음성) ── */
  const sayBtn = $('#m-say');
  if (!('speechSynthesis' in window)) sayBtn.parentElement.remove();
  else {
    sayBtn.addEventListener('click', () => {
      speechSynthesis.cancel();
      const text = `${RT.josa(title, '은/는')} ${room.floor}층에 있어요. ` + r.steps.map((s) => s.text).join('. ')
        .replace(/(\d{1,2})-(\d{1,2})반/g, '$1학년 $2반').replace(/\(초\)/g, ' 초등').replace(/\(중\)/g, ' 중등').replace(/(\d+)m(?![a-z])/g, '$1미터');
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR';
      u.rate = 1.0;
      speechSynthesis.speak(u);
    });
  }
})();
