/* 배달 호출 화면(call.html)의 한국어 / 영어 문구와 장소 이름 영어 번역
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
      appTitle: '피콕 배달 호출',
      appSub: '학교 안내 로봇',
      heroHi: '안녕하세요! 저는 피콕이에요',
      heroText: '있는 곳을 알려 주면 제가 찾아갈게요.',
      stepWhere: '장소', stepWhat: '요청', stepCheck: '확인',
      whereTitle: '피콕이 어디로 갈까요?',
      whereSub: '지금 있는 곳을 골라 주세요.',
      searchPh: '장소 검색 (보건실, 5-1, ㅂㄱㅅ)',
      recent: '최근 호출한 곳',
      floor: (n) => `${n}층`,
      floorShort: '층',
      groups: { class: '교실', office: '교무 · 행정', special: '특별실', facility: '편의 · 공용' },
      useTyped: (s) => `“${s}”(으)로 호출하기`,
      noRooms: '찾는 장소가 없어요. 아래 버튼으로 직접 입력해 주세요.',
      typedPlace: '직접 입력한 장소',
      whatTitle: '무엇을 도와드릴까요?',
      whatSub: '하나를 고르고, 필요하면 자세히 적어 주세요.',
      kinds: {
        deliver: ['서류·물건 전달', '다른 곳으로 가져가 주세요'],
        bring: ['물건 가져오기', '여기로 가져다 주세요'],
        guide: ['길 안내', '손님을 안내해 주세요'],
        other: ['기타', '직접 적을게요'],
      },
      notePh: '예: 교무실 김 선생님께 서류 전달',
      checkTitle: '이대로 호출할까요?',
      checkSub: '호출하면 피콕 화면에 바로 알림이 가요.',
      to: '갈 곳', request: '요청', name: '호출하는 사람', namePh: '예: 5-1 담임 김지은',
      pin: '학교 코드', pinPh: '학교에서 받은 코드',
      next: '다음', back: '이전', change: '바꾸기',
      send: '피콕 호출하기', sending: '호출하는 중…',
      needPlace: '먼저 피콕이 갈 장소를 골라 주세요.',
      needPin: '학교 코드를 넣어 주세요.',
      netFail: '호출하지 못했어요. 인터넷 연결을 확인해 주세요.',
      notReady: '호출 서버가 아직 준비되지 않았어요. 관리자에게 알려 주세요.',
      st: {
        waiting: ['호출했어요', '피콕이 곧 출발해요.'],
        accepted: ['피콕이 가고 있어요', '조금만 기다려 주세요.'],
        arrived: ['피콕이 도착했어요!', '주변에서 피콕을 찾아 주세요.'],
        done: ['배달을 마쳤어요', '이용해 주셔서 고마워요.'],
        canceled: ['호출이 취소됐어요', '필요하면 다시 호출해 주세요.'],
      },
      ahead: (n) => `앞에 호출 ${n}건이 있어요.`,
      steps: [['호출 접수', '피콕에게 전달됐어요'], ['피콕 출발', '피콕이 가고 있어요'], ['도착', '피콕이 도착했어요']],
      liveNote: '이 화면을 열어 두면 상태가 저절로 바뀌어요.',
      routeTitle: '피콕이 오는 길',
      routeMeta: (m, min) => `${m} · 약 ${min}분`,
      calledAt: (t) => `${t} 호출`,
      cancel: '호출 취소', again: '새로 호출하기', retry: '다시 확인',
      lost: '지난 호출을 찾지 못했어요. 새로 호출해 주세요.',
      offline: '연결이 잠시 끊겼어요. 다시 확인하는 중…',
      offlineTitle: '연결이 끊겼어요', offlineText: '인터넷 연결을 확인해 주세요.',
      loading: '호출 상태를 불러오는 중…',
      footer: '학교 안내 로봇 피콕 · 호출은 12시간 뒤 자동으로 정리돼요',
      langBtn: 'EN', langLabel: 'Switch to English',
      robotHere: '피콕 위치',
    },
    en: {
      appTitle: 'Call PEEKOK',
      appSub: 'School guide robot',
      heroHi: "Hi! I'm PEEKOK",
      heroText: "Tell me where you are and I'll come to you.",
      stepWhere: 'Place', stepWhat: 'Request', stepCheck: 'Confirm',
      whereTitle: 'Where should PEEKOK go?',
      whereSub: 'Choose the place where you are now.',
      searchPh: 'Search (Nurse, 5-1, Library)',
      recent: 'Recent places',
      floor: (n) => `Floor ${n}`,
      floorShort: 'F',
      groups: { class: 'Classrooms', office: 'Offices', special: 'Special rooms', facility: 'Facilities' },
      useTyped: (s) => `Call to “${s}”`,
      noRooms: 'No match. Use the button below to type the place yourself.',
      typedPlace: 'Typed place',
      whatTitle: 'How can PEEKOK help?',
      whatSub: 'Pick one and add details if needed.',
      kinds: {
        deliver: ['Deliver', 'Take something somewhere'],
        bring: ['Bring', 'Bring something here'],
        guide: ['Guide', 'Show a visitor the way'],
        other: ['Other', "I'll write it below"],
      },
      notePh: 'e.g. Take these papers to the main office',
      checkTitle: 'Ready to call?',
      checkSub: 'PEEKOK gets an alert on its screen right away.',
      to: 'Go to', request: 'Request', name: 'Your name', namePh: 'e.g. Ms. Kim, Grade 5-1',
      pin: 'School code', pinPh: 'Code from your school',
      next: 'Next', back: 'Back', change: 'Change',
      send: 'Call PEEKOK', sending: 'Calling…',
      needPlace: 'Please choose a place first.',
      needPin: 'Please enter the school code.',
      netFail: 'Could not send the call. Please check your connection.',
      notReady: 'The call server is not ready yet. Please tell the administrator.',
      st: {
        waiting: ['Call sent', 'PEEKOK will leave soon.'],
        accepted: ['PEEKOK is on the way', 'Just a moment, please.'],
        arrived: ['PEEKOK has arrived!', 'Look around for PEEKOK.'],
        done: ['All done', 'Thanks for calling PEEKOK.'],
        canceled: ['Call canceled', 'You can call again any time.'],
      },
      ahead: (n) => `${n} call${n > 1 ? 's' : ''} ahead of you.`,
      steps: [['Call received', 'PEEKOK got your call'], ['On the way', 'PEEKOK is coming'], ['Arrived', 'PEEKOK is here']],
      liveNote: 'Keep this page open. It updates by itself.',
      routeTitle: "PEEKOK's route to you",
      routeMeta: (m, min) => `${m} · about ${min} min`,
      calledAt: (t) => `Called at ${t}`,
      cancel: 'Cancel call', again: 'Make a new call', retry: 'Try again',
      lost: 'Could not find your last call. Please call again.',
      offline: 'Connection lost. Checking again…',
      offlineTitle: 'Connection lost', offlineText: 'Please check your internet connection.',
      loading: 'Loading your call…',
      footer: 'PEEKOK school guide robot · Calls are cleared after 12 hours',
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
