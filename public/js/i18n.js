/* 피콕 부르기 화면(index.html)의 한국어 / 영어 문구와 장소 이름 영어 번역
 *   언어 선택: 주소의 ?lang=en|ko → 이 기기에 저장된 값 → 브라우저 언어(한국어가 아니면 영어)
 */
window.KIS = window.KIS || {};

KIS.I18N = (function () {
  const SKEY = 'kis-lang';
  const q = new URLSearchParams(location.search).get('lang');
  let saved = null;
  try { saved = localStorage.getItem(SKEY); } catch (e) { /* 없음 */ }
  let lang = q === 'en' || q === 'ko' ? q : saved || (/^ko/i.test(navigator.language || 'ko') ? 'ko' : 'en');

  const T = {
    ko: {
      appTitle: '피콕 부르기',
      appSub: '학교 배달 로봇',
      heroHi: '안녕하세요! 저는 피콕이에요',
      heroText: '부르면 찾아가서 물건을 배달해 드려요.',
      how: ['여기서 부를 곳과 받는 곳을 정해요', '피콕이 오면 이 화면에 알려 드려요', '물건을 넣고 로봇 화면을 누르면 출발해요'],
      stepWhere: '부를 곳', stepDest: '받는 곳', stepWhat: '물건', stepCheck: '확인',
      destTitle: '어디로 보낼까요?',
      destSub: '물건을 받을 곳을 골라 주세요.',
      sameDest: '부를 곳과 같은 곳이에요',
      needDest: '물건을 받을 곳을 골라 주세요.',
      dest: '받는 곳',
      whoTitle: '누구에게 줄까요?', whoSub: '받는 곳에 도착하면 피콕 화면에 보여요. (선택)',
      recipient: '받는 사람', recipientPh: '예: 김민지 선생님',
      recipientChips: ['담임 선생님', '보건 선생님', '행정실', '교무실 선생님'],
      memo: '메모', memoPh: '예: 수업 자료예요, 급해요',
      arrivedTitle: '피콕이 도착했어요!',
      arrivedText: (to) => `물건을 넣고 피콕 화면을 눌러 주세요. ${to ? `${to}(으)로 ` : ''}바로 출발해요.`,
      arrivedSteps: ['피콕 안에 물건을 넣어요', '피콕 화면을 한 번 눌러요'],
      whereTitle: '피콕이 어디로 갈까요?',
      whereSub: '지금 있는 곳을 골라 주세요.',
      searchPh: '장소 검색 (보건실, 5-1, ㅂㄱㅅ)',
      recent: '최근 부른 곳',
      floor: (n) => `${n}층`,
      floorShort: '층',
      groups: { class: '교실', office: '교무 · 행정', special: '특별실', facility: '편의 · 공용' },
      noRooms: '맞는 장소가 없어요. 다른 이름으로 찾아보세요.',
      reachable: '피콕이 갈 수 있어요',
      unreachable: '피콕이 갈 수 없는 곳이에요 (엘리베이터로 못 가요)',
      whatTitle: '무엇을 보낼까요?',
      whatSub: '보낼 물건을 알려 주세요. (선택)',
      kinds: { docs: ['서류', '출석부·가정통신문'], item: ['물건', '교구·택배·준비물'], food: ['간식·음료', '조심히 옮길게요'], other: ['기타', '직접 적을게요'] },
      notePh: '예: 보건 서류, 출석부',
      checkTitle: '이대로 부를까요?',
      checkSub: '부르면 피콕 화면에 바로 알림이 가요.',
      to: '부를 곳', request: '보낼 물건', name: '보내는 사람', namePh: '예: 김민지 (5-1)',
      next: '다음', back: '이전', change: '바꾸기',
      send: '피콕 부르기', sending: '부르는 중…',
      needPlace: '먼저 피콕이 갈 장소를 골라 주세요.',
      netFail: '부르지 못했어요. 인터넷 연결을 확인해 주세요.',
      mode: { idle: '쉬는 중', to_caller: '호출 받고 이동 중', loading: '물건 싣는 중', delivering: '배달 중', at_recipient: '배달 도착', returning: '돌아가는 중', guiding: '길 안내 중', guided: '길 안내 중' },
      waitingN: (n) => ` · 대기 ${n}건`, robotOff: '로봇 꺼짐', checking: '확인 중', noConn: '연결 안 됨',
      st: {
        waiting: (x) => [x.ahead ? `앞에 ${x.ahead}건이 기다리고 있어요` : '곧 피콕이 출발해요',
          x.online ? (x.busy ? '피콕이 다른 배달을 하고 있어요. 차례가 되면 바로 갈게요.' : '피콕이 호출을 확인하고 있어요.') : '피콕 화면이 꺼져 있어요. 켜지면 바로 갈게요.'],
        coming: (x) => ['피콕이 가고 있어요!', `${x.from}(으)로 가는 중이에요. 조금만 기다려 주세요.`],
        loading: (x) => ['피콕이 도착했어요!', x.to ? '물건을 넣고 피콕 화면을 눌러 주세요.' : '물건을 넣고, 로봇 화면에서 받는 곳과 받는 사람을 골라 주세요.'],
        delivering: (x) => ['배달 중이에요', `${x.to}(으)로 가고 있어요.`],
        at_recipient: (x) => ['받는 곳에 도착했어요', `${x.to}에서 물건을 꺼내 가길 기다리고 있어요.`],
        delivered: (x) => ['배달 완료!', `${x.to}에 ${x.recipient ? `${x.recipient}님께 ` : ''}잘 전했어요. 고마워요!`],
        canceled: () => ['호출이 취소됐어요', '필요하면 다시 불러 주세요.'],
        expired: () => ['호출이 만료됐어요', '30분 동안 피콕이 오지 못했어요. 다시 불러 주세요.'],
      },
      steps: ['접수', '오는 중', '물건 싣기', '배달 중', '완료'],
      liveNote: '이 화면을 열어 두면 상태가 저절로 바뀌어요.',
      liveTitle: '피콕 위치', liveReady: '출발 준비 중', liveElev: '엘리베이터로 이동 중', liveMove: (f) => `${f}층에서 이동 중`,
      liveStart: '출발',
      fromFloor: (f) => `${f}층에서 와요`,
      d: { from: '부른 곳', caller: '보내는 사람', note: '보낼 물건', to: '받는 곳', memo: '메모' },
      calledAt: (t) => `${t}에 부름`,
      cancel: '호출 취소', cancelAsk: '호출을 취소할까요?', again: '새로 부르기',
      offline: '연결이 잠시 끊겼어요. 다시 확인하는 중…',
      loading: '호출 상태를 불러오는 중…',
      footer: '학교 안내·배달 로봇 피콕',
      langBtn: 'EN', langLabel: 'Switch to English',
      robotHere: '피콕',
    },
    en: {
      appTitle: 'Call PEEKOK',
      appSub: 'School delivery robot',
      heroHi: "Hi! I'm PEEKOK",
      heroText: "Call me and I'll come pick up your delivery.",
      how: ['Choose the pickup place and where it goes', "We'll tell you here when PEEKOK arrives", "Put your item in and tap PEEKOK's screen to send it"],
      stepWhere: 'Pickup', stepDest: 'Drop-off', stepWhat: 'Item', stepCheck: 'Confirm',
      destTitle: 'Where should it go?',
      destSub: 'Choose where the item should be delivered.',
      sameDest: 'Same as the pickup place',
      needDest: 'Please choose where it should go.',
      dest: 'Deliver to',
      whoTitle: 'Who is it for?', whoSub: "Shown on PEEKOK's screen at the drop-off. (Optional)",
      recipient: 'Recipient', recipientPh: 'e.g. Ms. Kim',
      recipientChips: ['Homeroom teacher', 'School nurse', 'Admin office', 'Staff room'],
      memo: 'Memo', memoPh: 'e.g. Class materials, urgent',
      arrivedTitle: 'PEEKOK has arrived!',
      arrivedText: (to) => `Put your item in and tap PEEKOK's screen. It will head ${to ? `to ${to} ` : ''}right away.`,
      arrivedSteps: ['Put your item inside PEEKOK', "Tap PEEKOK's screen once"],
      whereTitle: 'Where should PEEKOK go?',
      whereSub: 'Choose the place where you are now.',
      searchPh: 'Search (Nurse, 5-1, Library)',
      recent: 'Recent places',
      floor: (n) => `Floor ${n}`,
      floorShort: 'F',
      groups: { class: 'Classrooms', office: 'Offices', special: 'Special rooms', facility: 'Facilities' },
      noRooms: 'No match. Try another name.',
      reachable: 'PEEKOK can get there',
      unreachable: "PEEKOK can't reach this place (no elevator access)",
      whatTitle: 'What are you sending?',
      whatSub: 'Tell us what you are sending. (Optional)',
      kinds: { docs: ['Papers', 'Forms, attendance book'], item: ['Item', 'Supplies, packages'], food: ['Snacks & drinks', "I'll carry them gently"], other: ['Other', "I'll write it below"] },
      notePh: 'e.g. Health forms, attendance book',
      checkTitle: 'Ready to call?',
      checkSub: 'PEEKOK gets an alert on its screen right away.',
      to: 'Pick up at', request: 'Sending', name: 'Your name', namePh: 'e.g. Ms. Kim (5-1)',
      next: 'Next', back: 'Back', change: 'Change',
      send: 'Call PEEKOK', sending: 'Calling…',
      needPlace: 'Please choose a place first.',
      netFail: 'Could not send the call. Please check your connection.',
      mode: { idle: 'Available', to_caller: 'On a call', loading: 'Loading', delivering: 'Delivering', at_recipient: 'At drop-off', returning: 'Heading back', guiding: 'Guiding someone', guided: 'Guiding someone' },
      waitingN: (n) => ` · ${n} waiting`, robotOff: 'Robot offline', checking: 'Checking', noConn: 'No connection',
      st: {
        waiting: (x) => [x.ahead ? `${x.ahead} call${x.ahead > 1 ? 's' : ''} ahead of you` : 'PEEKOK will leave soon',
          x.online ? (x.busy ? "PEEKOK is on another delivery. It'll come right after." : 'PEEKOK is checking your call.') : "PEEKOK's screen is off. It'll come once it's on."],
        coming: (x) => ['PEEKOK is on the way!', `Heading to ${x.from}. Just a moment.`],
        loading: (x) => ['PEEKOK has arrived!', x.to ? "Put your item in and tap PEEKOK's screen." : "Put your item in, then choose where it goes on PEEKOK's screen."],
        delivering: (x) => ['Delivering', `On the way to ${x.to}.`],
        at_recipient: (x) => ['Arrived at drop-off', `Waiting at ${x.to} for the item to be picked up.`],
        delivered: (x) => ['Delivered!', `Delivered to ${x.to}${x.recipient ? ` for ${x.recipient}` : ''}. Thank you!`],
        canceled: () => ['Call canceled', 'You can call again any time.'],
        expired: () => ['Call expired', "PEEKOK couldn't come within 30 minutes. Please call again."],
      },
      steps: ['Received', 'Coming', 'Loading', 'Delivering', 'Done'],
      liveNote: 'Keep this page open. It updates by itself.',
      liveTitle: 'Where PEEKOK is', liveReady: 'Getting ready', liveElev: 'In the elevator', liveMove: (f) => `Moving on floor ${f}`,
      liveStart: 'Start',
      fromFloor: (f) => `From floor ${f}`,
      d: { from: 'Pick up at', caller: 'From', note: 'Sending', to: 'Deliver to', memo: 'Memo' },
      calledAt: (t) => `Called at ${t}`,
      cancel: 'Cancel call', cancelAsk: 'Cancel this call?', again: 'Make a new call',
      offline: 'Connection lost. Checking again…',
      loading: 'Loading your call…',
      footer: 'PEEKOK school guide & delivery robot',
      langBtn: '한국어', langLabel: '한국어로 보기',
      robotHere: 'PEEKOK',
    },
  };

  /* ── 장소 이름 영어 번역 ── */
  const NAMES = {
    '도우미 휴게실': "Staff Lounge", '인쇄실': 'Print Room', '다목적실': 'Multipurpose Room', 'IT실': 'IT Office', '서버실': 'Server Room',
    '시청각실': 'AV Room', '관찰실': 'Observation Room', '신한정보관': 'Shinhan Info Center', '한울마당': 'Hanul Hall', '보건실': "Nurse's Office",
    '상담실': 'Counseling Room', 'AI 컴퓨터실': 'AI Computer Lab', '창고': 'Storage', '교장실': "Principal's Office", '회의실': 'Meeting Room',
    '매점': 'School Store', '조리실': 'Kitchen', 'AI체험실': 'AI Lab', 'VR체험실': 'VR Lab', '소체육실': 'Small Gym', '원무실': 'Admissions Office',
    '전시실': 'Exhibition Room', '토요한글학교': 'Saturday Korean School', '이사회': 'Board Room', '야외무대': 'Outdoor Stage', '반얀트리': 'Banyan Tree',
    '문서고': 'Archive', '통합교육': 'Inclusive Education', 'CAFE': 'Café', '현관': 'Main Entrance', '학생회': 'Student Council', '2층 테라스': '2F Terrace',
    '방송실': 'Broadcasting Room', '성적처리실': 'Grading Office', '동아리 거울방': 'Club Mirror Room', '체육준비실': 'PE Storage', '체육관': 'Gymnasium',
    '도서실': 'Library', '과학실험실': 'Science Lab', '미술준비실': 'Art Prep Room', '음악준비실': 'Music Prep Room', '여자 휴게실': "Women's Lounge",
    '대기실': 'Green Room', '콘서트홀': 'Concert Hall', '밴드부': 'Band Room', '체육사무실': 'PE Office', '5층 홀': '5F Hall', '중체육관': 'Middle School Gym',
    '교감실·교무실 (기획·과정·연구)': "Vice Principal's Office", '사랑반 (유-2)': 'Kindergarten Sarang (K-2)', '기쁨반 (유-1)': 'Kindergarten Gippeum (K-1)',
    '교무실': "Teachers' Office",
    '탈의·샤워실 (여)': "Girls' Locker Room", '탈의·샤워실 (남)': "Boys' Locker Room",
  };
  const RULES = [
    [/^교사연구실 (.+)$/, (m) => `Teachers' Workroom ${m[1].replace('·', ' & ')}`],
    [/^행정실(\d)$/, (m) => `Admin Office ${m[1]}`],
    [/^식당(\d)$/, (m) => `Cafeteria ${m[1]}`],
    [/^컴퓨터실(\d)$/, (m) => `Computer Lab ${m[1]}`],
    [/^과학준비실$/, () => 'Science Prep Room'],
    [/^과학실$/, () => 'Science Room'],
    [/^음악실([AB]?)$/, (m) => `Music Room${m[1] ? ' ' + m[1] : ''}`],
    [/^미술실([AB]?)$/, (m) => `Art Room${m[1] ? ' ' + m[1] : ''}`],
    [/^영어(\d)$/, (m) => `English ${m[1]}`],
    [/^베트남(\d)$/, (m) => `Vietnamese ${m[1]}`],
    [/^세종(\d)$/, (m) => `Sejong ${m[1]}`],
    [/^교과(\d)$/, (m) => `Subject Room ${m[1]}`],
    [/^회의실$/, () => 'Meeting Room'],
    [/^상담실$/, () => 'Counseling Room'],
  ];
  const PARTS = { '초': 'Elem.', '초등': 'Elem.', '중': 'Middle', '중등': 'Middle', '4층': '4F', '자치문화': 'Student Life', '국제교육': 'Intl. Education',
    '12학년·진로진학': 'Grade 12 & Careers', '10·11학년': 'Grades 10–11', '학생교류': 'Student Exchange', 'MT3': 'MT3' };
  function tr(s) { return PARTS[s] || s; }

  function enName(room) {
    if (room.group === 'class' && room.grade > 0) return `Grade ${room.grade} Class ${room.klass}`;
    const n = room.name;
    if (NAMES[n]) return NAMES[n];
    const m = n.match(/^(.+?) \((.+)\)$/);
    const base = m ? m[1] : n, suf = m ? ` (${tr(m[2])})` : '';
    if (NAMES[base]) return NAMES[base] + suf;
    for (const [re, fn] of RULES) { const x = base.match(re); if (x) return fn(x) + suf; }
    return n;
  }

  return {
    get lang() { return lang; },
    t: (k) => (T[lang][k] !== undefined ? T[lang][k] : T.ko[k]),
    set(l) { lang = l; try { localStorage.setItem(SKEY, l); } catch (e) { /* 저장 불가 */ } document.documentElement.lang = l; },
    roomName(room) { return lang === 'en' ? enName(room) : KIS.Router.displayName(room); },
    enName,
  };
})();
