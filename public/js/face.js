/* 공작새 로봇 '피콕'의 디지털 얼굴
 * 표정: idle · happy(웃음) · listen(듣기) · think(생각) · sad(못 찾음) · sleep
 * 동작: 눈 깜빡임, 시선 이동(손가락을 따라봄), 말할 때 부리 움직임, 볏 흔들림
 */
window.KIS = window.KIS || {};

KIS.createFace = function (host, opts = {}) {
  const u = Math.random().toString(36).slice(2, 8);
  const id = (n) => `pk-${n}-${u}`;

  // 볏(머리 깃) 7가닥
  const angles = [-33, -22, -11, 0, 11, 22, 33];
  const lens = [44, 53, 58, 61, 58, 53, 44];
  const base = [120, 92];
  const crest = angles.map((a, i) => {
    const r = (a * Math.PI) / 180, L = lens[i];
    const tip = [base[0] + L * Math.sin(r), base[1] - L * Math.cos(r)];
    const ctl = [base[0] + L * 0.55 * Math.sin(r * 0.55), base[1] - L * 0.55 * Math.cos(r * 0.55)];
    return `<path d="M${base[0]} ${base[1]} Q${ctl[0].toFixed(1)} ${ctl[1].toFixed(1)} ${tip[0].toFixed(1)} ${tip[1].toFixed(1)}" class="pk-stem"/>` +
      `<g transform="translate(${tip[0].toFixed(1)} ${tip[1].toFixed(1)}) rotate(${a})">` +
      `<ellipse rx="6.6" ry="10.5" cy="-3" fill="url(#${id('tuft')})"/>` +
      `<ellipse rx="2.6" ry="5" cy="-2" fill="#0B4F86" opacity=".55"/></g>`;
  }).join('');

  const eye = (cx, mirror) => `
    <g class="pk-eye" transform="translate(${cx} 142)">
      <g transform="scale(${mirror ? -1 : 1} 1)" class="pk-marks">
        <path d="M-25 -4 C-20 -27 13 -33 28 -13 C13 -22 -11 -20 -25 -4Z" fill="#F6F9F3"/>
        <path d="M-21 12 C-13 29 13 30 24 14 C11 21 -8 21 -21 12Z" fill="#F6F9F3"/>
      </g>
      <g class="pk-eyeball" clip-path="url(#${id('clip')})">
        <ellipse rx="15" ry="16" fill="#08152F"/>
        <g class="pk-iris">
          <circle r="12" fill="url(#${id('iris')})"/>
          <circle r="6.2" fill="#070707"/>
          <circle cx="4.2" cy="-4.8" r="3.4" fill="#fff"/>
          <circle cx="-4" cy="4.2" r="1.5" fill="#fff" opacity=".75"/>
        </g>
        <g class="pk-lid"><rect x="-19" y="-52" width="38" height="36" fill="#1C5ED6"/><rect x="-19" y="-17.5" width="38" height="2.6" fill="#08152F"/></g>
      </g>
      <ellipse class="pk-rim" rx="15" ry="16" fill="none" stroke="#08152F" stroke-width="2.6"/>
      <path class="pk-happy" d="M-12 4 Q0 -10 12 4" fill="none" stroke="#08152F" stroke-width="4.6" stroke-linecap="round"/>
    </g>`;

  host.innerHTML = `
  <svg class="pk ${opts.mini ? 'pk--mini' : ''}" viewBox="${opts.mini ? '34 22 172 186' : '0 0 240 282'}" role="img" aria-label="공작새 로봇 피콕의 얼굴" data-mood="idle">
    <defs>
      <radialGradient id="${id('head')}" cx="48%" cy="40%" r="66%">
        <stop offset="0" stop-color="#3B98FF"/><stop offset=".55" stop-color="#1F68E0"/><stop offset="1" stop-color="#153CA4"/>
      </radialGradient>
      <linearGradient id="${id('neck')}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#2178EE"/><stop offset=".6" stop-color="#1A55CC"/><stop offset="1" stop-color="#123A9C"/>
      </linearGradient>
      <radialGradient id="${id('crown')}" cx="50%" cy="60%" r="60%">
        <stop offset="0" stop-color="#2AD1BE" stop-opacity=".95"/><stop offset=".7" stop-color="#1FA7B8" stop-opacity=".45"/><stop offset="1" stop-color="#1FA7B8" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${id('cheek')}" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="#2FD38C" stop-opacity=".9"/><stop offset=".6" stop-color="#1FB59A" stop-opacity=".45"/><stop offset="1" stop-color="#1FB59A" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="${id('beak')}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#FFFBF0"/><stop offset="1" stop-color="#D8CBAA"/>
      </linearGradient>
      <radialGradient id="${id('iris')}" cx="45%" cy="40%" r="60%">
        <stop offset="0" stop-color="#D08A4E"/><stop offset=".7" stop-color="#8E4620"/><stop offset="1" stop-color="#5E2A10"/>
      </radialGradient>
      <radialGradient id="${id('tuft')}" cx="50%" cy="40%" r="60%">
        <stop offset="0" stop-color="#4FE3E8"/><stop offset=".55" stop-color="#1CA3C9"/><stop offset="1" stop-color="#1361B5"/>
      </radialGradient>
      <pattern id="${id('scale')}" width="9" height="7" patternUnits="userSpaceOnUse">
        <path d="M0 7Q4.5 0.5 9 7" fill="none" stroke="#9DF3EA" stroke-opacity=".35" stroke-width="1"/>
      </pattern>
      <clipPath id="${id('clip')}"><ellipse rx="15" ry="16"/></clipPath>
      <filter id="${id('glow')}" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="9" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <g class="pk-tilt"><g class="pk-bob">
      <ellipse class="pk-aura" cx="120" cy="150" rx="74" ry="72" fill="#2A8CFF" opacity=".18" filter="url(#${id('glow')})"/>
      <path class="pk-neck" d="M88 282 C90 244 95 220 103 196 L137 196 C145 220 150 244 152 282Z" fill="url(#${id('neck')})"/>
      <path d="M112 206 C110 232 111 258 113 282" stroke="#5FB2FF" stroke-opacity=".35" stroke-width="5" fill="none" stroke-linecap="round"/>
      <g class="pk-crest">${crest}</g>
      <ellipse cx="120" cy="140" rx="64" ry="60" fill="url(#${id('head')})"/>
      <ellipse cx="120" cy="108" rx="50" ry="30" fill="url(#${id('crown')})"/>
      <ellipse cx="120" cy="114" rx="52" ry="36" fill="url(#${id('scale')})"/>
      <ellipse cx="84" cy="146" rx="30" ry="25" fill="url(#${id('cheek')})"/>
      <ellipse cx="156" cy="146" rx="30" ry="25" fill="url(#${id('cheek')})"/>
      <ellipse class="pk-blush" cx="72" cy="175" rx="9" ry="5" fill="#FF6F9E"/>
      <ellipse class="pk-blush" cx="168" cy="175" rx="9" ry="5" fill="#FF6F9E"/>
      ${eye(84, false)}
      ${eye(156, true)}
      <g class="pk-beak" transform="translate(120 150)">
        <ellipse class="pk-mouth" cx="0" cy="24" rx="4.2" ry="6" fill="#5B2230"/>
        <path class="pk-beak-low" d="M-8 12 Q-2 28 0 36 Q2 28 8 12 Q0 17 -8 12Z" fill="#C9B994"/>
        <path class="pk-beak-up" d="M-14 -1 Q0 -11 14 -1 Q12 17 0 32 Q-12 17 -14 -1Z" fill="url(#${id('beak')})"/>
        <path d="M0 -6 Q1.6 10 0 26" stroke="#fff" stroke-opacity=".55" stroke-width="2" fill="none" stroke-linecap="round"/>
        <ellipse cx="-5.4" cy="3" rx="1.6" ry="2.4" fill="#8A7C5E"/><ellipse cx="5.4" cy="3" rx="1.6" ry="2.4" fill="#8A7C5E"/>
      </g>
    </g></g>
  </svg>`;

  return KIS.faceBehavior(host.querySelector('svg'), opts);
};

/* 표정·동작 (작은 얼굴과 화면 얼굴이 같이 사용) */
KIS.faceBehavior = function (svg, opts = {}) {
  let mood = 'idle';
  let alive = true;
  let lastPointer = 0;
  const timers = new Set();
  const later = (fn, ms) => {
    const t = setTimeout(() => { timers.delete(t); if (alive) fn(); }, ms);
    timers.add(t);
    return t;
  };

  function setMood(m) { mood = m; svg.dataset.mood = m; }
  function blink() {
    if (mood === 'happy' || mood === 'sleep') return;
    svg.classList.add('is-blink');
    later(() => svg.classList.remove('is-blink'), 170);
  }
  function look(x, y) {
    const cx = Math.max(-1, Math.min(1, x)), cy = Math.max(-1, Math.min(1, y));
    const [rx, ry] = opts.range || [4.2, 4];
    svg.style.setProperty('--lx', `${(cx * rx).toFixed(2)}px`);
    svg.style.setProperty('--ly', `${(cy * ry).toFixed(2)}px`);
  }
  function talk(on) { svg.classList.toggle('is-talking', !!on); }
  function react(m = 'happy', ms = 1400) {
    const prev = mood === m ? 'idle' : mood;
    setMood(m);
    svg.classList.remove('is-bounce'); void svg.getBoundingClientRect(); svg.classList.add('is-bounce');
    later(() => { if (mood === m) setMood(prev); }, ms);
  }

  (function blinkLoop() {
    later(() => { blink(); if (Math.random() < 0.22) later(blink, 260); blinkLoop(); }, 2200 + Math.random() * 3600);
  })();
  (function lookLoop() {
    later(() => {
      if (Date.now() - lastPointer > 2500 && mood !== 'think') {
        if (Math.random() < 0.35) look(0, 0);
        else look(Math.random() * 2 - 1, Math.random() * 1.2 - 0.5);
      }
      lookLoop();
    }, 1600 + Math.random() * 3200);
  })();

  function onPointer(e) {
    if (!opts.follow || !svg.isConnected || !svg.getClientRects().length) return;
    const b = svg.getBoundingClientRect();
    lastPointer = Date.now();
    look((e.clientX - (b.left + b.width / 2)) / (b.width * 0.6), (e.clientY - (b.top + b.height * 0.5)) / (b.height * 0.6));
  }
  if (opts.follow) window.addEventListener('pointermove', onPointer, { passive: true });
  if (opts.follow) window.addEventListener('pointerdown', onPointer, { passive: true });

  return {
    el: svg, setMood, blink, look, talk, react,
    get mood() { return mood; },
    destroy() {
      alive = false; timers.forEach(clearTimeout);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
    },
  };
};

/* 로봇 머리 화면 전체를 채우는 얼굴
 * 화면 자체가 공작새의 얼굴이 됩니다: 가장자리까지 파란 깃털, 큰 눈과 흰 무늬, 가운데 부리.
 * 화면 비율(가로·세로)에 맞춰 얼굴이 꽉 차도록 자동으로 맞춥니다.
 */
KIS.createScreenFace = function (host, opts = {}) {
  const u = Math.random().toString(36).slice(2, 8);
  const id = (n) => `pks-${n}-${u}`;
  const eye = (cx, mirror) => `
    <g class="pk-eye" transform="translate(${cx} 112)">
      <g transform="scale(${mirror ? -1 : 1} 1)" class="pk-marks">
        <path d="M-60 -9.6C-48 -64.8 31.2 -79.2 67.2 -31.2C31.2 -52.8 -26.4 -48 -60 -9.6Z" fill="#F6F9F3"/>
        <path d="M-50.4 28.8C-31.2 69.6 31.2 72 57.6 33.6C26.4 50.4 -19.2 50.4 -50.4 28.8Z" fill="#F6F9F3"/>
      </g>
      <g class="pk-eyeball">
        <ellipse rx="36" ry="38" fill="#08152F"/>
        <g class="pk-iris">
          <circle r="28.5" fill="url(#${id('iris')})"/>
          <circle r="14.5" fill="#060606"/>
          <circle cx="10" cy="-11.5" r="8" fill="#fff"/>
          <circle cx="-9.5" cy="10" r="3.4" fill="#fff" opacity=".75"/>
        </g>
        <ellipse class="pk-rim" rx="36" ry="38" fill="none" stroke="#08152F" stroke-width="5"/>
      </g>
      <path class="pk-happy" d="M-29 9Q0 -24 29 9" fill="none" stroke="#08152F" stroke-width="10" stroke-linecap="round"/>
    </g>`;

  host.innerHTML = `
  <svg class="pk pk--screen" preserveAspectRatio="xMidYMid meet" role="img" aria-label="안내 로봇 피콕의 얼굴" data-mood="idle">
    <defs>
      <radialGradient id="${id('head')}" gradientUnits="userSpaceOnUse" cx="200" cy="135" r="330">
        <stop offset="0" stop-color="#2E8CF5"/><stop offset=".45" stop-color="#1F63DA"/><stop offset=".8" stop-color="#1743AD"/><stop offset="1" stop-color="#0F2E86"/>
      </radialGradient>
      <radialGradient id="${id('crown')}" gradientUnits="userSpaceOnUse" cx="200" cy="-30" r="230">
        <stop offset="0" stop-color="#2AD3C0" stop-opacity=".9"/><stop offset=".6" stop-color="#1FA7B8" stop-opacity=".35"/><stop offset="1" stop-color="#1FA7B8" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${id('cheek')}" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="#2FD38C" stop-opacity=".85"/><stop offset=".6" stop-color="#1FB59A" stop-opacity=".4"/><stop offset="1" stop-color="#1FB59A" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${id('iris')}" cx="45%" cy="40%" r="60%">
        <stop offset="0" stop-color="#D38D50"/><stop offset=".7" stop-color="#8E4620"/><stop offset="1" stop-color="#5A280F"/>
      </radialGradient>
      <linearGradient id="${id('beak')}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#FFFBF0"/><stop offset="1" stop-color="#D8CBAA"/>
      </linearGradient>
      <pattern id="${id('scale')}" width="26" height="18" patternUnits="userSpaceOnUse">
        <path d="M0 18Q13 2 26 18" fill="none" stroke="#A8F1FF" stroke-opacity=".07" stroke-width="1.3"/>
      </pattern>
    </defs>
    <rect x="-3000" y="-3000" width="6400" height="6400" fill="url(#${id('head')})"/>
    <rect x="-3000" y="-3000" width="6400" height="6400" fill="url(#${id('scale')})"/>
    <ellipse cx="200" cy="-30" rx="330" ry="150" fill="url(#${id('crown')})"/>
    <g class="pk-tilt"><g class="pk-bob"><g class="pk-features">
      <ellipse cx="122" cy="118" rx="80" ry="66" fill="url(#${id('cheek')})"/>
      <ellipse cx="278" cy="118" rx="80" ry="66" fill="url(#${id('cheek')})"/>
      <ellipse class="pk-blush" cx="86" cy="178" rx="20" ry="10" fill="#FF6F9E"/>
      <ellipse class="pk-blush" cx="314" cy="178" rx="20" ry="10" fill="#FF6F9E"/>
      ${eye(122, false)}
      ${eye(278, true)}
      <g transform="translate(200 131) scale(2.4)"><g class="pk-beak">
        <ellipse class="pk-mouth" cx="0" cy="24" rx="4.2" ry="6" fill="#5B2230"/>
        <path class="pk-beak-low" d="M-8 12Q-2 28 0 36Q2 28 8 12Q0 17 -8 12Z" fill="#C9B994"/>
        <path class="pk-beak-up" d="M-14 -1Q0 -11 14 -1Q12 17 0 32Q-12 17 -14 -1Z" fill="url(#${id('beak')})"/>
        <path d="M0 -6Q1.6 10 0 26" stroke="#fff" stroke-opacity=".55" stroke-width="2" fill="none" stroke-linecap="round"/>
        <ellipse cx="-5.4" cy="3" rx="1.6" ry="2.4" fill="#8A7C5E"/><ellipse cx="5.4" cy="3" rx="1.6" ry="2.4" fill="#8A7C5E"/>
      </g></g>
    </g></g></g>
  </svg>`;

  const svg = host.querySelector('svg');
  // 화면 비율에 맞춰 얼굴(눈·무늬·부리)이 꽉 차게
  const CW = 330, CH = 248, CX = 200, CY = 137; // 아래쪽은 자막 자리로 조금 비워 둠
  function fit() {
    const w = host.clientWidth || window.innerWidth, h = host.clientHeight || window.innerHeight;
    const a = w / h;
    let vw, vh;
    if (a >= CW / CH) { vh = CH; vw = CH * a; } else { vw = CW; vh = CW / a; }
    svg.setAttribute('viewBox', `${(CX - vw / 2).toFixed(2)} ${(CY - vh / 2).toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}`);
  }
  fit();
  window.addEventListener('resize', fit);
  const ctl = KIS.faceBehavior(svg, Object.assign({ range: [10, 9] }, opts));
  const destroy = ctl.destroy;
  ctl.destroy = () => { window.removeEventListener('resize', fit); destroy(); };
  return ctl;
};
