/* 학교 안내 로봇 화면 흐름
 *   얼굴 화면(대기) → 터치 → 메인 메뉴 → 장소 선택 → 길 안내(지도 + 단계별 설명 + 음성)
 */
(function () {
  const CFG = KIS.CONFIG, D = KIS.DATA, RT = KIS.Router, S = KIS.Search, I = KIS.icon;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  /* ── 설정 (관리자 화면에서 바꾼 값은 이 기기에 저장) ── */
  const store = {
    get() { try { return JSON.parse(localStorage.getItem('kis-robot-settings') || '{}'); } catch (e) { return {}; } },
    set(v) { try { localStorage.setItem('kis-robot-settings', JSON.stringify(v)); } catch (e) { /* 저장 불가 */ } },
  };
  const saved = store.get();
  const state = {
    location: saved.location || CFG.robotLocation,
    voice: saved.voice !== undefined ? saved.voice : CFG.voice,
    idleSec: saved.idleSec || CFG.idleTimeoutSec,
    mode: 'stairs',
    current: null,
    stack: [],
  };
  const at = new URLSearchParams(location.search).get('at'); // ?at=층,x,y  (로봇이 여러 대일 때)
  if (at) {
    const [f, x, y] = at.split(',').map(Number);
    if (D.floorById(f) && !isNaN(x) && !isNaN(y)) state.location = { floor: f, x, y, label: `${f}층 안내 로봇 앞` };
  }

  /* ── 얼굴 ── */
  const bigFace = KIS.createScreenFace($('#big-face'), { follow: true });
  const miniFace = KIS.createFace($('#mini-face'), { mini: true });
  const voiceFace = KIS.createFace($('#voice-face'), { mini: true });
  const faces = [bigFace, miniFace, voiceFace];

  /* ── 말하기 (TTS) ── */
  const Speech = {
    voice: null,
    init() {
      if (!('speechSynthesis' in window)) return;
      const pick = () => {
        const vs = speechSynthesis.getVoices();
        this.voice = vs.find((v) => /ko[-_]KR/i.test(v.lang) && /google|natural|neural/i.test(v.name)) || vs.find((v) => /^ko/i.test(v.lang)) || null;
      };
      pick();
      speechSynthesis.onvoiceschanged = pick;
    },
    spoken(text) {
      return text
        .replace(/(\d{1,2})-(\d{1,2})반/g, '$1학년 $2반')
        .replace(/\(초\)/g, ' 초등').replace(/\(중\)/g, ' 중등')
        .replace(/(\d+)m(?![a-z])/g, '$1미터')
        .replace(/[▲▼→·]/g, ' ');
    },
    say(text) {
      clearTimeout(this.t);
      faces.forEach((f) => f.talk(true));
      const stopTalk = () => faces.forEach((f) => f.talk(false));
      if (!state.voice || !('speechSynthesis' in window)) {
        this.t = setTimeout(stopTalk, Math.min(3200, 600 + text.length * 55));
        return;
      }
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(this.spoken(text));
      u.lang = 'ko-KR';
      if (this.voice) u.voice = this.voice;
      u.rate = CFG.voiceRate;
      u.onend = u.onerror = stopTalk;
      speechSynthesis.speak(u);
      this.t = setTimeout(stopTalk, 1500 + text.length * 160); // 이벤트가 안 오는 기기 대비
    },
    stop() {
      clearTimeout(this.t);
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      faces.forEach((f) => f.talk(false));
    },
  };
  Speech.init();

  function bubble(text, speak = true) {
    const b = $('#bubble');
    b.textContent = text;
    b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    if (speak) Speech.say(text);
  }

  /* ── 공통 데이터 ── */
  const byName = (name, floor) => D.rooms().find((r) => r.name === name && (!floor || r.floor === floor));
  const LISTS = {
    교무실: { title: '교무실', icon: 'office', filter: (r) => /교무실|교감실/.test(r.name) },
    행정실: { title: '행정실 · 교장실', icon: 'admin', filter: (r) => /행정실|교장실|원무실|문서고/.test(r.name) },
    식당: { title: '식당 · 매점 · 카페', icon: 'meal', filter: (r) => /식당|매점|CAFE/.test(r.name) },
    체육관: { title: '체육 시설', icon: 'gym', filter: (r) => /체육|탈의|거울방/.test(r.name) },
    상담: { title: '상담실', icon: 'chat', filter: (r) => /상담/.test(r.name) },
    office: { title: '교무 · 행정실', icon: 'office', filter: (r) => r.group === 'office' },
    special: { title: '특별실', icon: 'flask', filter: (r) => r.group === 'special' },
    facility: { title: '편의 · 공용시설', icon: 'star', filter: (r) => r.group === 'facility' && r.cat !== 'restroom' && r.cat !== 'elev', specials: true },
  };
  const QUICK = [
    { icon: 'restroom', title: '화장실', sub: '가장 가까운 곳', act: 'nearest', arg: 'restroom', tone: 'teal' },
    { icon: 'health', title: '보건실', act: 'room', arg: byName('보건실').id, tone: 'red' },
    { icon: 'office', title: '교무실', act: 'list', arg: '교무실', tone: 'blue' },
    { icon: 'admin', title: '행정실', act: 'list', arg: '행정실', tone: 'slate' },
    { icon: 'book', title: '도서실', act: 'room', arg: byName('도서실').id, tone: 'purple' },
    { icon: 'meal', title: '식당·매점', act: 'list', arg: '식당', tone: 'orange' },
    { icon: 'gym', title: '체육관', act: 'list', arg: '체육관', tone: 'green' },
    { icon: 'chat', title: '상담실', act: 'list', arg: '상담', tone: 'pink' },
  ];
  const catLabel = (room) => (room.cat === 'restroom' ? '화장실' : D.catNames[room.cat] || '');
  const nameOf = (room) => RT.displayName(room);

  function roomCard(room, extra = '') {
    return `<button class="place cat-${room.cat}" data-action="room" data-id="${room.id}">
      <span class="place-floor">${room.floor}층</span>
      <span class="place-name">${esc(room.title || room.name)}</span>
      ${extra ? `<span class="place-sub">${esc(extra)}</span>` : `<span class="place-sub">${esc(catLabel(room))}</span>`}
    </button>`;
  }
  function specialCard(kind) {
    const t = kind === 'restroom' ? ['restroom', '가장 가까운 화장실'] : ['elevator', '가장 가까운 엘리베이터'];
    return `<button class="place place-special" data-action="nearest" data-id="${kind}">
      <span class="place-floor">${I(t[0])}</span><span class="place-name">${t[1]}</span><span class="place-sub">현재 위치에서 찾기</span></button>`;
  }
  function viewHead(title, sub = '', right = '') {
    return `<div class="view-head">
      <button class="back-btn" data-action="back">${I('back')}<span>뒤로</span></button>
      <div class="view-title"><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>
      <div class="view-head-right">${right}</div>
    </div>`;
  }

  /* ── 화면들 ── */
  const views = {
    home() {
      return `<section class="view view-home">
        <div class="home-hero">
          <div class="home-title"><h1>어디로 가시나요?</h1><p>장소를 누르거나 이름을 검색해 보세요.${SR ? ' 말로 물어봐도 돼요.' : ''}</p></div>
          <div class="search-row">
            <button class="search-box" data-action="search">${I('search')}<span>장소 이름 검색 <em>예) 보건실, 5-1, ㅂㄱㅅ</em></span></button>
            ${SR ? `<button class="mic-btn" data-action="voice">${I('mic')}<span>말로 묻기</span></button>` : ''}
          </div>
        </div>
        <div class="quick-grid">
          ${QUICK.map((q) => `<button class="quick tone-${q.tone}" data-action="${q.act}" data-id="${q.arg}">
            <span class="quick-ico">${I(q.icon)}</span><b>${q.title}</b>
            <span>${q.sub || (q.act === 'room' ? `${D.roomById(q.arg).floor}층` : `${D.rooms().filter(LISTS[q.arg].filter).length}곳`)}</span></button>`).join('')}
        </div>
        <div class="cat-row">
          ${[
            ['cat-main', 'classes', '', 'classroom', '교실 찾기', '학년 · 반으로 찾기'],
            ['', 'list', 'office', 'office', '교무·행정실', '교장실 · 회의실 · 방송실'],
            ['', 'list', 'special', 'flask', '특별실', '과학 · 음악 · 컴퓨터'],
            ['', 'list', 'facility', 'star', '편의·공용시설', '카페 · 시청각실 · 콘서트홀'],
            ['', 'map', '', 'map', '층별 안내도', '1층 ~ 5층 지도'],
          ].map(([cls, act, id, ico, t, sub]) => `<button class="cat-card ${cls}" data-action="${act}"${id ? ` data-id="${id}"` : ''}>
            ${I(ico)}<span class="cat-text"><b>${t}</b><span>${sub}</span></span></button>`).join('')}
        </div>
      </section>`;
    },

    classes(p) {
      const grades = [
        { g: 0, label: '유치원', tone: 'elem' }, ...[1, 2, 3, 4, 5, 6].map((g) => ({ g, label: `${g}학년`, tone: 'elem' })),
        ...[7, 8, 9, 10, 11, 12].map((g) => ({ g, label: `${g}학년`, tone: 'middle' })), { g: 'int', label: '통합교육', tone: 'elem' },
      ];
      const sel = p.grade;
      const list = sel === undefined ? [] : D.rooms().filter((r) => r.group === 'class' && r.grade === sel).sort((a, b) => a.klass - b.klass || a.name.localeCompare(b.name));
      return `<section class="view view-classes">
        ${viewHead('교실 찾기', '학년을 고르면 반이 나와요')}
        <div class="grade-groups">
          <div class="grade-group"><h3><i class="dot dot-elem"></i>유치원 · 초등</h3>
            <div class="grade-grid">${grades.filter((x) => x.tone === 'elem').map((x) => `<button class="grade ${sel === x.g ? 'is-on' : ''} tone-${x.tone}" data-action="grade" data-id="${x.g}">${x.label}</button>`).join('')}</div></div>
          <div class="grade-group"><h3><i class="dot dot-middle"></i>중등 (7 ~ 12학년)</h3>
            <div class="grade-grid">${grades.filter((x) => x.tone === 'middle').map((x) => `<button class="grade ${sel === x.g ? 'is-on' : ''} tone-${x.tone}" data-action="grade" data-id="${x.g}">${x.label}</button>`).join('')}</div></div>
        </div>
        <div class="class-list">
          ${sel === undefined ? `<div class="hint-card">${I('hand')}<span>위에서 학년을 눌러 주세요</span></div>`
            : `<h3 class="class-list-title">${grades.find((x) => x.g === sel).label} · ${list.length}개 반</h3>
               <div class="class-grid">${list.map((r) => `<button class="class-btn cat-${r.cat}" data-action="room" data-id="${r.id}">
                 <b>${esc(r.grade > 0 ? `${r.name}반` : (r.label || r.name).replace('\n', ' '))}</b><span>${r.floor}층</span></button>`).join('')}</div>`}
        </div>
      </section>`;
    },

    list(p) {
      const def = LISTS[p.id];
      const rooms = D.rooms().filter((r) => r.searchable && def.filter(r));
      const floors = [...new Set(rooms.map((r) => r.floor))].sort();
      return `<section class="view view-list">
        ${viewHead(def.title, `${rooms.length}곳 · 누르면 길을 안내해요`)}
        <div class="list-scroll">
          ${def.specials ? `<div class="floor-block"><h3>바로 찾기</h3><div class="place-grid">${specialCard('restroom')}${specialCard('elevator')}</div></div>` : ''}
          ${floors.map((f) => `<div class="floor-block"><h3><span class="floor-chip">${f}층</span></h3>
            <div class="place-grid">${rooms.filter((r) => r.floor === f).map((r) => roomCard(r)).join('')}</div></div>`).join('')}
        </div>
      </section>`;
    },

    results(p) {
      const res = S.search(p.q, { voice: p.voice });
      const shown = p.voice ? S.clean(p.q) : p.q;
      if (!res.length) {
        return `<section class="view view-results">
          ${viewHead(`‘${esc(shown)}’ 검색 결과`)}
          <div class="empty">
            <div class="empty-face" id="empty-face"></div>
            <h2>앗, 그런 곳을 찾지 못했어요</h2>
            <p>이름을 조금 바꿔서 찾아보거나, 아래에서 골라 보세요.</p>
            <div class="empty-actions">
              <button class="btn" data-action="search">${I('search')}다시 검색</button>
              <button class="btn" data-action="classes">${I('classroom')}교실 찾기</button>
              <button class="btn" data-action="map">${I('map')}층별 안내도</button>
            </div>
          </div>
        </section>`;
      }
      return `<section class="view view-results">
        ${viewHead(`‘${esc(shown)}’ 검색 결과`, `${res.length}곳을 찾았어요`)}
        <div class="list-scroll"><div class="place-grid">
          ${res.map((x) => (x.special ? specialCard(x.special) : roomCard(x.room))).join('')}
        </div></div>
      </section>`;
    },

    map(p) {
      const f = p.floor || state.location.floor;
      const fl = D.floorById(f);
      const order = { class: 0, special: 1, office: 2, facility: 3 };
      const places = fl.rooms.filter((r) => r.searchable && r.cat !== 'restroom' && r.cat !== 'elev')
        .sort((a, b) => (order[a.group] - order[b.group]) || (a.grade || 0) - (b.grade || 0) || (a.klass || 0) - (b.klass || 0) || a.name.localeCompare(b.name));
      return `<section class="view view-map">
        ${viewHead('층별 안내도', '장소를 누르면 길을 안내해요', floorTabs(f, 'mapfloor'))}
        ${legend(false, 'map-legend--strip')}
        <div class="card map-card" style="--map-ar: ${fl.viewBox[2]} / ${fl.viewBox[3]}">
          <div class="map-host" id="browse-map"></div>
          <div class="room-sheet" id="room-sheet" hidden></div>
        </div>
        <div class="floor-places">
          <h3>${fl.name}의 장소 <span>${places.length}곳 · 누르면 길을 안내해요</span></h3>
          <div class="chip-grid">${places.map((r) => `<button class="chip cat-${r.cat}" data-action="room" data-id="${r.id}">${esc(r.group === 'class' && r.grade > 0 ? `${r.name}반` : r.title || r.name)}</button>`).join('')}</div>
        </div>
      </section>`;
    },

    route(p) {
      const r = state.route;
      if (!r) return views.notfound();
      const room = r.room;
      const segs = r.segments;
      const cur = state.seg;
      const title = p.kind === 'restroom' ? '가장 가까운 화장실' : p.kind === 'elevator' ? '가장 가까운 엘리베이터' : (room.title || room.name);
      const mins = r.seconds < 50 ? '1분 이내' : `약 ${Math.round(r.seconds / 60)}분`;
      const multi = r.floorsMoved > 0;
      return `<section class="view view-route">
        <div class="card route-map">
          <div class="map-top">
            <div class="floor-steps">
              ${segs.map((s, i) => `<button class="floor-step ${i === cur ? 'is-on' : ''}" data-action="seg" data-id="${i}">
                <b>${s.floor}층</b><span>${i === 0 ? (segs.length === 1 ? '같은 층' : '출발') : i === segs.length - 1 ? '도착' : '경유'}</span></button>`).join(`<span class="floor-arrow">${I('chevron')}</span>`)}
            </div>
            ${legend(true)}
          </div>
          <div class="map-host" id="route-map"></div>
          ${segs.length > 1 && cur < segs.length - 1 ? `<button class="next-floor" data-action="seg" data-id="${cur + 1}">${segs[cur + 1].floor}층 지도 보기 ${I('chevron')}</button>` : ''}
          ${segs.length > 1 && cur > 0 ? `<button class="prev-floor" data-action="seg" data-id="${cur - 1}">${I('back')} ${segs[cur - 1].floor}층</button>` : ''}
        </div>
        <aside class="card route-panel">
          <div class="dest-row">
          <div class="dest">
            <span class="dest-badge cat-${room.cat}"><b>${room.floor}</b>층</span>
            <div class="dest-text"><h2>${esc(title)}</h2><p>${p.kind ? `${room.floor}층 · ${esc(RT.landmark(room.floor, RT.roomCenter(room), 30, room) ? `${nameOf(RT.landmark(room.floor, RT.roomCenter(room), 30, room))} 근처` : '')}` : `${esc(catLabel(room))} · ${room.floor}층`}</p></div>
          </div>
          <div class="dest-meta">
            <div><b>${RT.fmtMeters(r.meters)}</b><span>거리</span></div>
            <div><b>${mins}</b><span>걸어서</span></div>
            <div><b>${multi ? `${r.floorsMoved}개 층` : '같은 층'}</b><span>${multi ? (r.usesElevator ? '엘리베이터' : '계단') : '층 이동 없음'}</span></div>
          </div>
          </div>
          ${multi ? `<div class="mode-toggle" role="group" aria-label="이동 방법">
            <button class="${state.mode === 'stairs' ? 'is-on' : ''}" data-action="mode" data-id="stairs">${I('stairs')}계단으로</button>
            <button class="${state.mode === 'elevator' ? 'is-on' : ''}" data-action="mode" data-id="elevator">${I('wheelchair')}엘리베이터로</button>
          </div>` : ''}
          ${r.fallback ? `<p class="note">엘리베이터만으로는 갈 수 없어서 계단을 함께 안내해요.</p>` : ''}
          <ol class="steps">
            ${r.steps.map((s, i) => `<li><button class="step ${segIndexForStep(s) === cur ? 'is-cur' : ''} step-${s.icon}" data-action="step" data-id="${i}">
              <span class="step-ico">${I(s.icon === 'arrive' ? 'arrive' : s.icon)}</span>
              <span class="step-text">${esc(s.text)}</span>
              <span class="step-floor">${s.floor}층</span></button></li>`).join('')}
          </ol>
          <button class="qr-btn" data-action="qr">${I('qr')}<span><b>휴대폰으로 보기</b><small>QR 코드를 찍으면 이 길 안내가 휴대폰에 떠요</small></span>${I('chevron')}</button>
          <div class="route-actions">
            <button class="btn" data-action="replay">${I('sound')}다시 듣기</button>
            <button class="btn btn-primary" data-action="back">${I('search')}다른 곳 찾기</button>
          </div>
        </aside>
      </section>`;
    },

    notfound() {
      return `<section class="view">${viewHead('길 안내')}<div class="empty"><h2>경로를 찾지 못했어요</h2><p>선생님께 문의해 주세요.</p></div></section>`;
    },
  };

  function floorTabs(cur, action) {
    return `<div class="floor-tabs" role="tablist">${D.floors.map((f) => `<button role="tab" class="${f.id === cur ? 'is-on' : ''}" data-action="${action}" data-id="${f.id}">${f.name}${f.id === state.location.floor ? '<i class="here-dot" title="현재 층"></i>' : ''}</button>`).join('')}</div>`;
  }
  function legend(route, cls = '') {
    const cats = `<span><i class="sw sw-elem"></i>유/초등</span><span><i class="sw sw-middle"></i>중등</span><span><i class="sw sw-common"></i>공용</span><span><i class="sw sw-admin"></i>관리·부대</span>`;
    return `<div class="map-legend ${cls}">${route ? '<span><i class="sw sw-you"></i>현재 위치</span><span><i class="sw sw-route"></i>가는 길</span>' : '<span><i class="sw sw-you"></i>현재 위치</span>'}${cats}</div>`;
  }
  function segIndexForStep(s) {
    const segs = state.route.segments;
    if (s.floorChange || s.icon === 'start') {
      const i = segs.findIndex((g) => g.floor === s.floor);
      return i < 0 ? 0 : i;
    }
    for (let i = segs.length - 1; i >= 0; i--) if (segs[i].floor === s.floor) return i;
    return 0;
  }

  /* ── 화면 전환 ── */
  let mapView = null;
  function go(view, params = {}, opt = {}) {
    if (opt.push !== false && state.current) state.stack.push(state.current);
    state.current = { view, params };
    render();
  }
  function back() {
    const prev = state.stack.pop();
    state.current = prev || { view: 'home', params: {} };
    render();
  }
  function goHome() { state.stack = []; state.current = null; go('home', {}, { push: false }); }

  function render() {
    const { view, params } = state.current;
    const main = $('#view');
    mapView = null;
    main.innerHTML = views[view](params);
    main.dataset.view = view;
    main.scrollTop = 0;
    if (view === 'map') mountBrowseMap(params);
    if (view === 'route') mountRouteMap();
    if (view === 'results' && $('#empty-face')) {
      const f = KIS.createFace($('#empty-face'), { mini: true });
      f.setMood('sad');
    }
    if (view === 'home') { miniFace.setMood('idle'); }
  }

  function mountBrowseMap(p) {
    const f = p.floor || state.location.floor;
    mapView = new KIS.MapView($('#browse-map'), { onRoomTap: (id) => showSheet(id) });
    mapView.setFloor(f);
    if (f === state.location.floor) mapView.you(state.location.x, state.location.y, '현재 위치');
  }
  function showSheet(id) {
    const room = D.roomById(id);
    if (!room) return;
    mapView.clearOverlay();
    if (mapView.floorId === state.location.floor) mapView.you(state.location.x, state.location.y, '현재 위치');
    mapView.highlight(id, 'is-picked');
    const sh = $('#room-sheet');
    sh.hidden = false;
    sh.innerHTML = `<div class="sheet-text"><span class="dest-badge cat-${room.cat}"><b>${room.floor}</b>층</span>
      <div><h3>${esc(room.title || room.name)}</h3><p>${esc(catLabel(room))}</p></div></div>
      <button class="btn btn-primary" data-action="room" data-id="${room.id}">${I('arrive')}여기로 길 안내</button>
      <button class="sheet-close" data-action="sheet-close" aria-label="닫기">${I('close')}</button>`;
  }

  function mountRouteMap() {
    const r = state.route;
    mapView = new KIS.MapView($('#route-map'), {});
    showSeg(state.seg, false);
    // 여러 층이면 출발 층을 보여 준 뒤 자동으로 다음 층을 한 번 보여 준다
    clearTimeout(state.autoSeg);
    if (r.segments.length > 1 && state.seg === 0 && !state.autoShown) {
      state.autoShown = true;
      state.autoSeg = setTimeout(() => {
        if (state.current && state.current.view === 'route' && state.seg === 0) { state.seg = 1; render(); }
      }, 9000);
    }
  }
  function showSeg(i) {
    const r = state.route;
    const seg = r.segments[i];
    mapView.setFloor(seg.floor);
    // 지도는 고정: 층 전체가 한눈에 보이게 (확대·이동 없음)
    mapView.showRoute(seg, { isFirst: i === 0, prevFloor: i > 0 ? r.segments[i - 1].floor : null, room: r.room });
    // 지금 보고 있는 층의 안내 단계가 보이도록
    const cur = document.querySelector('.step.is-cur');
    if (cur) cur.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /* ── 길 안내 시작 ── */
  function startRoute(target, kind) {
    let r;
    if (kind) {
      const pred = kind === 'restroom' ? (x) => x.cat === 'restroom' : (x) => x.cat === 'elev';
      r = RT.nearest(state.location, pred, { mode: state.mode });
    } else {
      const room = D.roomById(target);
      r = room && RT.route(state.location, room, { mode: state.mode });
    }
    state.route = r;
    state.seg = 0;
    state.autoShown = false;
    const params = kind ? { kind } : { id: target };
    if (state.current && state.current.view === 'route') { state.current.params = params; render(); }
    else go('route', params);
    if (!r) { bubble('죄송해요, 그곳으로 가는 길을 찾지 못했어요.'); miniFace.setMood('sad'); return; }
    announce(r, kind);
  }

  function announce(r, kind) {
    const name = kind === 'restroom' ? '가장 가까운 화장실' : kind === 'elevator' ? '가장 가까운 엘리베이터' : nameOf(r.room);
    const sameFloor = r.room.floor === state.location.floor;
    const head = `${RT.josa(name, '은/는')} ${sameFloor ? `이 층(${r.room.floor}층)` : `${r.room.floor}층`}에 있어요.`;
    miniFace.react('happy', 1600);
    $('#bubble').textContent = `${head} 지도를 보고 따라가세요!`;
    Speech.say(`${head} ${r.steps.slice(1).map((s) => s.text).join('. ')}.`);
  }

  /* ── 이벤트 ── */
  $('#view').addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action, id = b.dataset.id;
    switch (a) {
      case 'search': Keyboard.open(); break;
      case 'voice': Voice.start(); break;
      case 'room': startRoute(id); break;
      case 'nearest': startRoute(null, id); break;
      case 'list': go('list', { id }); bubble(`${LISTS[id].title} 중에서 가실 곳을 골라 주세요.`, false); break;
      case 'classes': go('classes', {}); bubble('몇 학년 교실을 찾으세요?'); break;
      case 'grade': state.current.params = { grade: id === 'int' ? 'int' : Number(id) }; render(); break;
      case 'map': go('map', { floor: state.location.floor }); bubble('지도에서 장소를 눌러 보세요.', false); break;
      case 'mapfloor': state.current.params = { floor: Number(id) }; render(); break;
      case 'back': back(); break;
      case 'seg': clearTimeout(state.autoSeg); state.autoShown = true; state.seg = Number(id); render(); break;
      case 'mode':
        if (state.mode !== id) {
          state.mode = id;
          const p = state.current.params;
          startRoute(p.id, p.kind);
        }
        break;
      case 'replay': if (state.route) announce(state.route, state.current.params.kind); break;
      case 'step': {
        const s = state.route.steps[Number(id)];
        const i = segIndexForStep(s);
        clearTimeout(state.autoSeg); state.autoShown = true;
        if (i !== state.seg) { state.seg = i; render(); }
        setTimeout(() => mapView && mapView.flash(s.at[0], s.at[1]), 450);
        Speech.say(s.text);
        break;
      }
      case 'qr': QR.open(); break;
      case 'sheet-close': $('#room-sheet').hidden = true; mapView.clearOverlay(); if (mapView.floorId === state.location.floor) mapView.you(state.location.x, state.location.y, '현재 위치'); break;
      default: break;
    }
  });

  $('#btn-home').addEventListener('click', () => { Speech.stop(); goHome(); bubble('어디로 안내해 드릴까요?', false); });
  $('#btn-sound').addEventListener('click', () => {
    state.voice = !state.voice;
    renderSoundBtn();
    if (!state.voice) Speech.stop(); else Speech.say('음성 안내를 켰어요.');
  });
  function renderSoundBtn() {
    const b = $('#btn-sound');
    b.innerHTML = I(state.voice ? 'sound' : 'mute') + `<span>${state.voice ? '소리 켬' : '소리 끔'}</span>`;
    b.setAttribute('aria-pressed', String(state.voice));
  }
  renderSoundBtn();
  $('#mini-face').addEventListener('click', () => { miniFace.react('happy'); Speech.say(`저는 ${iAm}. 무엇이든 물어보세요!`); });

  /* ── 얼굴 화면 ↔ 메뉴 ── */
  const faceScreen = $('#face-screen'), appScreen = $('#app-screen');
  const iAm = `안내 로봇 ${RT.josa(CFG.robotName, '이에요/예요')}`;
  let waking = false;

  // 얼굴이 말하는 자막 (화면 아래쪽에 잠깐 나타났다 사라짐)
  let capT, capTalkT;
  function caption(text, ms = 4200) {
    const c = $('#face-caption');
    clearTimeout(capT); clearTimeout(capTalkT);
    c.textContent = text;
    c.classList.add('is-on');
    bigFace.talk(true);
    capTalkT = setTimeout(() => bigFace.talk(false), Math.min(2600, 500 + text.length * 70));
    capT = setTimeout(() => c.classList.remove('is-on'), ms);
  }
  function clearCaption() {
    clearTimeout(capT); clearTimeout(capTalkT);
    $('#face-caption').classList.remove('is-on');
    bigFace.talk(false);
  }

  function wake() {
    if (waking) return;
    waking = true;
    clearTimeout(idleCapT);
    bigFace.react('happy', 1400);
    caption('안녕하세요! 어디로 안내해 드릴까요?', 2000);
    Speech.say(`안녕하세요! 저는 ${iAm}. 어디로 안내해 드릴까요?`);
    setTimeout(() => {
      faceScreen.classList.remove('is-active');
      appScreen.classList.add('is-active');
      clearCaption();
      $('#bubble').textContent = '어디로 안내해 드릴까요?';
      goHome();
      waking = false;
      resetIdle();
    }, 1100);
  }
  function sleep() {
    Speech.stop();
    Keyboard.close();
    Voice.stop();
    closeAdmin();
    QR.close();
    state.mode = 'stairs';
    state.route = null;
    state.stack = [];
    appScreen.classList.remove('is-active');
    faceScreen.classList.add('is-active');
    bigFace.setMood('idle');
    clearCaption();
    scheduleIdleCaption(2500);
  }
  faceScreen.addEventListener('click', wake);
  faceScreen.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') wake(); });

  let idleT;
  function resetIdle() {
    clearTimeout(idleT);
    if (!appScreen.classList.contains('is-active')) return;
    idleT = setTimeout(sleep, state.idleSec * 1000);
  }
  ['pointerdown', 'keydown', 'wheel'].forEach((ev) => document.addEventListener(ev, resetIdle, { passive: true }));

  // 기다리는 동안 가끔 말을 걸기 (자막만, 소리 없음)
  const idleLines = [
    `안녕하세요! 저는 ${iAm}`,
    '저를 터치하면 길을 안내해 드려요',
    '보건실, 교무실, 5-1반… 어디든 물어보세요',
    SR ? '“도서실 어디예요?” 하고 말로 물어봐도 돼요' : '가장 가까운 화장실도 알려 드려요',
  ];
  let idleCapT, idleI = 0;
  function scheduleIdleCaption(ms) {
    clearTimeout(idleCapT);
    if (CFG.faceCaptions === false) return;
    idleCapT = setTimeout(() => {
      if (faceScreen.classList.contains('is-active') && !waking) {
        caption(idleLines[idleI % idleLines.length]);
        idleI++;
      }
      scheduleIdleCaption(11000 + Math.random() * 6000);
    }, ms);
  }
  scheduleIdleCaption(2500);

  /* ── 시계 ── */
  function tick() {
    const d = new Date();
    const days = '일월화수목금토';
    const hh = d.getHours(), mm = String(d.getMinutes()).padStart(2, '0');
    const t = `${hh < 12 ? '오전' : '오후'} ${hh % 12 || 12}:${mm}`;
    const ds = `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
    $('#clock').innerHTML = `<b>${t}</b><span>${ds}</span>`;
  }
  tick();
  setInterval(tick, 10000);

  /* ── 화면 키보드 ── */
  const Keyboard = (function () {
    const box = $('#kbd');
    const comp = new KIS.Hangul.Composer();
    let layout = 'ko', shift = false;
    const KO = [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'], ['ㅂ', 'ㅈ', 'ㄷ', 'ㄱ', 'ㅅ', 'ㅛ', 'ㅕ', 'ㅑ', 'ㅐ', 'ㅔ'], ['ㅁ', 'ㄴ', 'ㅇ', 'ㄹ', 'ㅎ', 'ㅗ', 'ㅓ', 'ㅏ', 'ㅣ'], ['⇧', 'ㅋ', 'ㅌ', 'ㅊ', 'ㅍ', 'ㅠ', 'ㅜ', 'ㅡ', '⌫']];
    const SHIFT = { ㅂ: 'ㅃ', ㅈ: 'ㅉ', ㄷ: 'ㄸ', ㄱ: 'ㄲ', ㅅ: 'ㅆ', ㅐ: 'ㅒ', ㅔ: 'ㅖ' };
    const EN = [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'], ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'], ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'], ['Z', 'X', 'C', 'V', 'B', 'N', 'M', '⌫']];

    function keys() {
      const rows = layout === 'ko' ? KO : EN;
      const html = rows.map((row) => `<div class="kbd-row">${row.map((k) => {
        if (k === '⇧') return `<button class="key key-wide ${shift ? 'is-on' : ''}" data-k="shift" aria-label="쌍자음">${I('shift')}</button>`;
        if (k === '⌫') return `<button class="key key-wide" data-k="bs" aria-label="지우기">${I('backspace')}</button>`;
        const v = layout === 'ko' && shift && SHIFT[k] ? SHIFT[k] : k;
        return `<button class="key" data-k="${v}">${v}</button>`;
      }).join('')}</div>`).join('');
      $('#kbd-keys').innerHTML = html + `<div class="kbd-row">
        <button class="key key-wide" data-k="lang">${layout === 'ko' ? 'ABC' : '한글'}</button>
        <button class="key key-space" data-k=" ">띄어쓰기</button>
        <button class="key key-wide" data-k="clear">전체 지움</button>
        <button class="key key-go" data-k="go">${I('search')}검색</button></div>`;
    }
    function update() {
      const v = comp.value();
      $('#kbd-text').textContent = v;
      $('#kbd-placeholder').hidden = !!v;
      const res = v.trim() ? S.search(v, { limit: 8 }) : [];
      $('#kbd-results').innerHTML = !v.trim() ? '<p class="kbd-tip">장소 이름의 첫 글자(초성)만 눌러도 찾을 수 있어요. 예) ㅂㄱㅅ → 보건실</p>'
        : res.length ? res.map((x) => (x.special
          ? `<button class="kbd-hit" data-hit-nearest="${x.special}"><b>${x.special === 'restroom' ? '가장 가까운 화장실' : '가장 가까운 엘리베이터'}</b></button>`
          : `<button class="kbd-hit cat-${x.room.cat}" data-hit="${x.room.id}"><b>${esc(x.room.group === 'class' && x.room.grade > 0 ? `${x.room.name}반` : x.room.title || x.room.name)}</b><span>${x.room.floor}층</span></button>`)).join('')
          : '<p class="kbd-tip">아직 맞는 장소가 없어요</p>';
    }
    box.addEventListener('click', (e) => {
      const hit = e.target.closest('[data-hit]');
      if (hit) { close(); startRoute(hit.dataset.hit); return; }
      const hn = e.target.closest('[data-hit-nearest]');
      if (hn) { close(); startRoute(null, hn.dataset.hitNearest); return; }
      if (e.target.closest('[data-kbd-close]')) { close(); return; }
      const k = e.target.closest('[data-k]');
      if (!k) return;
      const v = k.dataset.k;
      if (v === 'shift') { shift = !shift; keys(); return; }
      if (v === 'lang') { layout = layout === 'ko' ? 'en' : 'ko'; shift = false; keys(); return; }
      if (v === 'bs') comp.backspace();
      else if (v === 'clear') comp.clear();
      else if (v === 'go') {
        const q = comp.value().trim();
        if (!q) return;
        close();
        const res = S.search(q);
        if (res.length === 1 && !res[0].special) startRoute(res[0].room.id);
        else go('results', { q });
        return;
      } else {
        comp.input(v);
        if (shift) { shift = false; keys(); }
      }
      update();
    });
    // 실제 키보드로도 입력 가능 (관리·테스트용)
    document.addEventListener('keydown', (e) => {
      if (box.hidden) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'Backspace') { comp.backspace(); update(); }
      else if (e.key === 'Enter') box.querySelector('[data-k="go"]').click();
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { comp.input(e.key.toUpperCase() === e.key.toLowerCase() ? e.key : e.key.toUpperCase()); update(); }
    });
    function open() {
      comp.clear(); layout = 'ko'; shift = false;
      keys(); update();
      box.hidden = false;
      requestAnimationFrame(() => box.classList.add('is-open'));
      bubble('찾는 장소 이름을 눌러 주세요.', false);
    }
    function close() { box.classList.remove('is-open'); box.hidden = true; }
    return { open, close };
  })();

  /* ── 음성 질문 ── */
  const Voice = (function () {
    const box = $('#voice');
    let rec = null, final = '';
    function stop() {
      if (rec) { try { rec.abort(); } catch (e) { /* noop */ } rec = null; }
      box.hidden = true;
      voiceFace.setMood('idle');
    }
    function status(t, sub = '') { $('#voice-status').textContent = t; $('#voice-text').textContent = sub; }
    function start() {
      if (!SR) return;
      Speech.stop();
      box.hidden = false;
      voiceFace.setMood('listen');
      status('듣고 있어요…', '“보건실 어디예요?” 처럼 말해 주세요');
      $('#voice-retry').hidden = true;
      final = '';
      rec = new SR();
      rec.lang = 'ko-KR';
      rec.interimResults = true;
      rec.maxAlternatives = 3;
      rec.onresult = (e) => {
        let t = '';
        for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
        $('#voice-text').textContent = `“${t}”`;
        if (e.results[e.results.length - 1].isFinal) final = t;
      };
      rec.onerror = (e) => {
        voiceFace.setMood('sad');
        status(e.error === 'not-allowed' ? '마이크를 쓸 수 없어요' : '잘 못 들었어요', e.error === 'not-allowed' ? '브라우저에서 마이크 권한을 허용해 주세요' : '조금 더 크게 다시 말해 주세요');
        $('#voice-retry').hidden = false;
      };
      rec.onend = () => {
        if (!rec) return;
        rec = null;
        if (!final) { if ($('#voice-retry').hidden) { voiceFace.setMood('sad'); status('잘 못 들었어요', '버튼을 누르고 다시 말해 주세요'); $('#voice-retry').hidden = false; } return; }
        handle(final);
      };
      try { rec.start(); } catch (e) { status('음성 인식을 시작할 수 없어요'); }
    }
    function handle(text) {
      voiceFace.setMood('think');
      const res = S.search(text, { voice: true });
      setTimeout(() => {
        stop();
        const top = res[0], second = res[1];
        if (top && top.score >= 95 && (!second || top.score - second.score >= 8 || top.special)) {
          if (top.special) startRoute(null, top.special); else startRoute(top.room.id);
        } else {
          go('results', { q: text, voice: true });
          bubble(res.length ? '이 중에서 골라 주세요.' : '찾지 못했어요. 다른 이름으로 말해 볼까요?');
        }
      }, 500);
    }
    box.addEventListener('click', (e) => {
      if (e.target.closest('[data-voice-close]')) stop();
      if (e.target.closest('#voice-retry')) start();
    });
    return { start, stop };
  })();

  /* ── QR 코드: 길 안내를 휴대폰으로 가져가기 ──
   * 휴대폰용 페이지(m.html) 주소에 목적지·로봇 위치·이동 방법을 담는다.
   * 휴대폰에서도 같은 데이터로 같은 경로를 계산하므로 서버가 필요 없다.
   */
  const QR = (function () {
    const box = $('#qr');
    let closeT;
    function routeUrl() {
      const p = state.current.params, r = state.route, L = state.location;
      const base = new URL('m.html', CFG.publicUrl || location.href).toString();
      let q = `to=${encodeURIComponent(r.room.id)}&at=${L.floor},${L.x},${L.y}`;
      if (state.mode !== 'stairs') q += `&mode=${state.mode}`;
      if (p.kind) q += `&k=${p.kind}`;
      return `${base}?${q}`;
    }
    function svgFor(text) {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount(), m = 4;
      let d = '';
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + m} ${y + m}h1v1h-1z`;
      return `<svg viewBox="0 0 ${n + m * 2} ${n + m * 2}" shape-rendering="crispEdges" role="img" aria-label="길 안내 QR 코드">
        <rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#0F2138"/></svg>`;
    }
    function open() {
      if (!state.route) return;
      const p = state.current.params, room = state.route.room;
      const title = p.kind === 'restroom' ? '가장 가까운 화장실' : p.kind === 'elevator' ? '가장 가까운 엘리베이터' : (room.title || room.name);
      const url = routeUrl();
      $('#qr-code').innerHTML = svgFor(url);
      $('#qr-dest').innerHTML = `<span class="dest-badge cat-${room.cat}"><b>${room.floor}</b>층</span><b>${esc(title)}</b>`;
      $('#qr-host').textContent = new URL(url).host;
      box.hidden = false;
      requestAnimationFrame(() => box.classList.add('is-open'));
      bubble('휴대폰 카메라로 QR 코드를 찍어 보세요!');
      clearTimeout(closeT);
      closeT = setTimeout(close, 90000);
    }
    function close() {
      clearTimeout(closeT);
      box.classList.remove('is-open');
      box.hidden = true;
    }
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-qr-close]')) close(); });
    return { open, close, url: () => routeUrl() };
  })();

  /* ── 관리자 설정 (시계를 3초간 길게 누르기) ── */
  let holdT;
  const clock = $('#clock');
  clock.addEventListener('pointerdown', () => { holdT = setTimeout(openAdmin, CFG.adminHoldMs); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => clock.addEventListener(ev, () => clearTimeout(holdT)));

  let adminMap = null, pending = null;
  function openAdmin() {
    const box = $('#admin');
    pending = Object.assign({}, state.location);
    box.hidden = false;
    box.innerHTML = `<div class="admin-card" role="dialog" aria-modal="true" aria-label="관리자 설정">
      <div class="admin-head"><h2>${I('settings')}관리자 설정</h2><button class="sheet-close" data-adm="close" aria-label="닫기">${I('close')}</button></div>
      <div class="admin-body">
        <div class="admin-map">
          <div class="admin-row"><b>로봇 위치</b><span id="adm-loc">${esc(pending.label)}</span></div>
          <div id="adm-tabs">${floorTabs(pending.floor, 'adm-floor')}</div>
          <div class="map-host" id="adm-map"></div>
          <p class="admin-tip">지도에서 로봇이 서 있는 복도 위치를 눌러 주세요.</p>
        </div>
        <div class="admin-opts">
          <label class="admin-opt"><span>음성 안내 기본값</span><select id="adm-voice"><option value="1" ${state.voice ? 'selected' : ''}>켜기</option><option value="0" ${!state.voice ? 'selected' : ''}>끄기</option></select></label>
          <label class="admin-opt"><span>얼굴 화면으로 돌아가는 시간</span><select id="adm-idle">${[30, 60, 90, 120, 180, 300].map((s) => `<option value="${s}" ${s === state.idleSec ? 'selected' : ''}>${s}초</option>`).join('')}</select></label>
          <button class="btn" data-adm="fullscreen">${I('grid')}전체 화면</button>
          <button class="btn" data-adm="default">${I('refresh')}기본값으로</button>
          <button class="btn btn-primary" data-adm="save">저장</button>
        </div>
      </div></div>`;
    adminMap = new KIS.MapView($('#adm-map'), { onMapTap: pickLoc });
    showAdminFloor(pending.floor);
  }
  function showAdminFloor(f) {
    adminMap.setFloor(f);
    if (pending.floor === f) adminMap.you(pending.x, pending.y, '로봇');
    $('#adm-tabs').innerHTML = floorTabs(f, 'adm-floor');
  }
  function pickLoc(p) {
    const f = adminMap.floorId;
    const at = RT.debug.attachPoint(f, p, null);
    const lm = RT.landmark(f, at.pt, 30);
    pending = { floor: f, x: Math.round(at.pt[0] * 10) / 10, y: Math.round(at.pt[1] * 10) / 10, label: `${f}층 ${lm ? `${RT.displayName(lm)} 앞` : '복도'}` };
    $('#adm-loc').textContent = pending.label;
    adminMap.clearOverlay();
    adminMap.you(pending.x, pending.y, '로봇');
  }
  function closeAdmin() { $('#admin').hidden = true; $('#admin').innerHTML = ''; adminMap = null; }
  $('#admin').addEventListener('click', (e) => {
    const t = e.target.closest('[data-adm],[data-action="adm-floor"]');
    if (!t) return;
    if (t.dataset.action === 'adm-floor') { showAdminFloor(Number(t.dataset.id)); return; }
    const a = t.dataset.adm;
    if (a === 'close') closeAdmin();
    if (a === 'fullscreen') { const d = document.documentElement; (d.requestFullscreen || d.webkitRequestFullscreen || (() => {})).call(d); }
    if (a === 'default') { store.set({}); location.reload(); }
    if (a === 'save') {
      state.location = pending;
      state.voice = $('#adm-voice').value === '1';
      state.idleSec = Number($('#adm-idle').value);
      store.set({ location: state.location, voice: state.voice, idleSec: state.idleSec });
      renderSoundBtn();
      closeAdmin();
      goHome();
      bubble(`위치를 ${state.location.label}(으)로 저장했어요.`, false);
    }
  });

  /* ── 태블릿(로봇 얼굴)용 처리 ── */
  // 화면이 꺼지지 않게 (Screen Wake Lock). 탭이 다시 보이면 다시 요청한다.
  let wakeLock = null;
  async function keepAwake() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { /* 지원하지 않거나 거부됨: 태블릿 설정에서 '화면 꺼짐 안 함'으로 */ }
  }
  keepAwake();
  document.addEventListener('visibilitychange', keepAwake);
  document.addEventListener('pointerdown', keepAwake, { passive: true }); // 일부 브라우저는 터치 후에만 허용
  // 길게 누르기 메뉴, 두 손가락 페이지 확대(iOS), 드래그 방지 — 지도 확대는 지도 안에서만
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  ['gesturestart', 'gesturechange'].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault()));
  document.addEventListener('dragstart', (e) => e.preventDefault());
  document.addEventListener('touchstart', () => {}, { passive: true }); // iOS 에서 :active 눌림 효과가 보이게

  /* ── 시작 ── */
  document.title = `${CFG.title} ${CFG.robotName}`;
  if (/[?&]start=app/.test(location.search)) { faceScreen.classList.remove('is-active'); appScreen.classList.add('is-active'); goHome(); }
  const deep = new URLSearchParams(location.search).get('to');
  if (deep && D.roomById(deep)) { faceScreen.classList.remove('is-active'); appScreen.classList.add('is-active'); goHome(); startRoute(deep); }
  window.KIS.app = { go, startRoute, sleep, wake, state };
})();
