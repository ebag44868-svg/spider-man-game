// 게임 밖 화면에 뜨는 목록 데이터 (모드 · 슈트 · 소식 · 크레딧 · 설정 배치)
//
// 화면(src/ui/shell.js)은 이 표를 그리기만 한다. 새 모드나 슈트가 생기면 여기 한 줄을 바꾼다.
// status: "open" = 할 수 있다 · "soon" = 자리만 있다 (카드에 '준비 중')

const GAME_VERSION = "0.9.0-dev";

const MODES = [
  { id: "free",      name: "자유 탐험",         desc: "뉴욕 전체를 제한 없이 누빈다",           status: "open" },
  { id: "story",     name: "스토리",            desc: "본편 미션 — 뉴욕을 지키는 하루",         status: "soon" },
  { id: "race",      name: "체크포인트 레이스", desc: "링을 순서대로 통과해 최단 기록을 낸다",  status: "soon" },
  { id: "challenge", name: "챌린지",            desc: "속도 · 고도 · 정밀 착지 과제",           status: "soon" },
  { id: "photo",     name: "포토 모드",         desc: "시간을 멈추고 카메라를 자유롭게",        status: "soon" },
];

// 슈트. unlock 은 업적 id — 진행 보상은 숫자(+3%)가 아니라 '겉모습 · 새 행동'으로 준다 (문서 02).
const SUITS = [
  { id: "classic", name: "클래식",       desc: "빨강 · 파랑 · 거미줄 무늬",   status: "open" },
  { id: "noir",    name: "누아르",       desc: "흑백 필름 톤",                status: "soon", unlock: "km_42" },
  { id: "stealth", name: "스텔스",       desc: "야간 전용 무광 슈트",         status: "soon", unlock: "alt_1000" },
  { id: "homemade", name: "홈메이드",     desc: "후드티와 고글",               status: "soon", unlock: "speed_350" },
];

// 최신이 위. id 가 바뀌면 타이틀의 '소식' 에 새 글 표시가 붙는다.
const NEWS = [
  { id: "2026-09-19", title: "게임 밖 화면 정리",
    body: "모드 선택 · 기록 · 업적 · 설정 · 일시정지 · 결과 화면이 생겼다. 기록과 설정은 이 브라우저에 저장된다." },
  { id: "2026-09-18", title: "도심이 높아졌다",
    body: "건물 전반 상향. 한복판은 1km 가 넘는 초고층 무리가 선다." },
  { id: "2026-09-17", title: "속도감 · 양손 새총",
    body: "벽을 스치면 바람이 훅 지나간다. 좌우 클릭을 같이 누르면 양손으로 거미줄을 걸고, 당겼다가 튕겨 나간다." },
];

const CREDITS = [
  { role: "엔진",            who: "three.js (MIT)" },
  { role: "캐릭터 모델 · 동작", who: "Mixamo (Adobe)" },
  { role: "뉴욕 거리 소품",   who: "출처 정리 중 — 배포 전 확인 필요" },
  { role: "효과음",          who: "Web Audio 즉석 합성 (파일 없음)" },
];

// 설정 화면 배치. key 가 있으면 game3d.js 의 SETTINGS 표 항목이고, 없으면 '준비 중' 자리다.
const SETTINGS_TABS = [
  { id: "play", name: "게임플레이", rows: [
    { key: "view", label: "시점 (P)" },
    { key: "aim", label: "3인칭 조준" },
    { key: "cam", label: "카메라 (C)" },
    { key: "speed", label: "게임 속도" },
  ] },
  { id: "screen", name: "화면", rows: [
    { key: "ui", label: "화면 정보 (H)" },
    { key: "roll", label: "1인칭 기울기" },
    { key: "shake", label: "화면 흔들림" },
    { label: "그래픽 품질", soon: "해상도는 지금 프레임에 맞춰 자동으로 조절된다" },
    { label: "시야각", soon: "속도에 따라 자동으로 넓어진다" },
  ] },
  { id: "sound", name: "소리", rows: [
    { key: "audio", label: "효과음" },
    { label: "전체 음량", soon: "" },
    { label: "음악", soon: "배경음이 아직 없다" },
  ] },
  { id: "input", name: "조작", rows: [
    { key: "sens", label: "마우스 감도" },
    { key: "invertY", label: "상하 반전" },
    { label: "키 재설정", soon: "" },
    { label: "게임패드", soon: "" },
  ] },
];

export { GAME_VERSION, MODES, SUITS, NEWS, CREDITS, SETTINGS_TABS };
