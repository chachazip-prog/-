/* 샘플 데이터 — HBA/HBL(T&E Policy 2025.12.15), HBJ(出張旅費規程 2024.03.29)는 유첨 규정 문서 기준.
   HYB는 화면 예시용 가상 값(확정 규정 아님). HBC/HBI는 규정 미등록 상태 예시. */
window.DATA = (function () {
  const TODAY = '2026.11.13';

  const corps = [
    { code: 'HYB', name: '(주)하이브', country: '대한민국', cur: 'KRW', headcount: 1524, sample: true,
      draft: { budget: { on: true, at: '2026.03.09', by: '서준석' }, card: { on: true, at: '2026.03.09', by: '서준석' }, attendance: { on: true, at: '2026.03.09', by: '서준석' } } },
    { code: 'HBA', name: 'HYBE AMERICA', country: '미국', cur: 'USD', headcount: 412,
      draft: { budget: { on: false, at: '2026.10.20', by: '윤채희' }, card: { on: false, at: '2026.10.20', by: '윤채희' }, attendance: { on: false, at: '2026.10.20', by: '윤채희' } } },
    { code: 'HBL', name: 'HYBE LATIN AMERICA', country: '멕시코', cur: 'USD', headcount: 96,
      draft: { budget: { on: false, at: '2026.10.20', by: '윤채희' }, card: { on: false, at: '2026.10.20', by: '윤채희' }, attendance: { on: false, at: '2026.10.20', by: '윤채희' } } },
    { code: 'HBJ', name: 'HYBE JAPAN', country: '일본', cur: 'JPY', headcount: 268,
      draft: { budget: { on: true, at: '2026.10.27', by: '윤채희' }, card: { on: false, at: '2026.10.20', by: '윤채희' }, attendance: { on: true, at: '2026.10.27', by: '윤채희' } } },
    { code: 'HBC', name: 'HYBE CHINA', country: '중국', cur: 'CNY', headcount: 41,
      draft: { budget: { on: false, at: null, by: null }, card: { on: false, at: null, by: null }, attendance: { on: false, at: null, by: null } } },
    { code: 'HBI', name: 'HYBE INDIA', country: '인도', cur: 'INR', headcount: 23,
      draft: { budget: { on: false, at: null, by: null }, card: { on: false, at: null, by: null }, attendance: { on: false, at: null, by: null } } },
  ];

  /* 기안 항목 정의 (구성원 '출장 기안' 화면의 섹션) */
  const draftItems = [
    { key: 'budget', name: '출장 예산', desc: '승인된 출장 예산 불러오기, 신규 WBS 예산 / 판관·자산 예산 신청',
      link: '예산(업무공간 > 예산) 연동', offEffect: '기안 화면에서 [출장 예산] 섹션 미노출. 예산 연결 없이 결재 상신' },
    { key: 'card', name: '법인카드 실시간 한도증액', desc: '출장 비용 결제용 법인카드의 한도 증액 신청 (카드 추가)',
      link: '법인카드 한도 관리 연동', offEffect: '기안 화면에서 [법인카드 한도 증액] 섹션 미노출' },
    { key: 'attendance', name: '출장 근태 신청', desc: '출장 기간에 대한 근태(출장) 자동 신청 — 근태코드·구분·지역·근태 신청자',
      link: '근태 시스템 연동', offEffect: '기안 화면에서 [출장 근태 신청] 섹션 미노출. 근태는 법인 자체 절차로 처리' },
  ];

  /* 구성원 등급 (법인별 정의, 인사정보 직급/직책 코드 매핑) */
  const grades = {
    HYB: [
      { id: 'g1', name: '임원', desc: 'C-Level, 사내이사, 임원급 리더', hr: ['CEO', 'C-Level', '사내이사', '임원'], count: 38 },
      { id: 'g2', name: '리더', desc: '실장·팀장 등 조직장', hr: ['실장', '팀장', '파트장'], count: 214 },
      { id: 'g3', name: '구성원', desc: '그 외 전 구성원', hr: ['구성원(전체 직급)'], count: 1272, isDefault: true },
    ],
    HBA: [
      { id: 'g1', name: 'Tier 1', desc: 'C-Suite and President-level employee', hr: ['C-Suite', 'President'], count: 9 },
      { id: 'g2', name: 'Tier 2', desc: 'VP, SVP and EVPs', hr: ['EVP', 'SVP', 'VP'], count: 37 },
      { id: 'g3', name: 'Tier 3', desc: 'Below VP', hr: ['Senior Director', 'Director', 'Manager', 'Staff'], count: 366, isDefault: true },
    ],
    HBL: [
      { id: 'g1', name: 'Tier 1', desc: 'C-Suite and President-level employee', hr: ['C-Suite', 'President'], count: 3 },
      { id: 'g2', name: 'Tier 2', desc: 'VP, SVP and EVPs', hr: ['EVP', 'SVP', 'VP'], count: 8 },
      { id: 'g3', name: 'Tier 3', desc: 'Below VP', hr: ['Director', 'Manager', 'Staff'], count: 85, isDefault: true },
    ],
    HBJ: [
      { id: 'g1', name: '리더그룹·SP 이상', desc: '経営リーダー·事業リーダー·専門家リーダー 및 SP(Sr. Professional) 이상', hr: ['経営リーダー', '事業リーダー', '専門家リーダー', 'SP'], count: 31 },
      { id: 'g2', name: '일반 구성원', desc: 'チーム員·職責者(チーム長 이상, 리더그룹 제외)', hr: ['職責者', 'チーム員'], count: 237, isDefault: true },
    ],
    HBC: [], HBI: [],
  };

  /* 개인 예외 지정 (직급 매핑과 다른 등급을 개별 부여) */
  const gradeExceptions = {
    HYB: [], HBL: [], HBC: [], HBI: [],
    HBA: [
      { empNo: 'A100231', name: 'Jordan Lee', dept: 'Artist Relations', hrTitle: 'Senior Director', from: 'g3', to: 'g2', reason: '아티스트 동행 상시 업무 (CFO 승인)', start: '2026.01.01', end: '2026.12.31', by: '윤채희', at: '2025.12.22' },
      { empNo: 'A100518', name: 'Maria Santos', dept: 'Global Touring', hrTitle: 'Director', from: 'g3', to: 'g2', reason: '2026 월드투어 총괄 기간 한시 적용', start: '2026.03.01', end: '2026.11.30', by: '윤채희', at: '2026.02.24' },
    ],
    HBJ: [
      { empNo: 'J200077', name: '佐藤 美咲', dept: 'Artist Management', hrTitle: 'チーム員', from: 'g2', to: 'g1', reason: '아티스트 운영 담당 — 동급 좌석 동승(규정 제5조 2-1-②)', start: '2026.04.01', end: '', by: '서준석', at: '2026.03.28' },
    ],
  };

  /* 지역 그룹 (법인별 정의. 출장지 관리의 국가·도시를 묶어 규정 값의 열로 사용) */
  const regions = {
    HYB: [
      { id: 'r1', name: '국내', places: ['대한민국 전체'] },
      { id: 'r2', name: '일본·동남아', places: ['일본', '대만', '홍콩', '마카오', '태국', '싱가포르', '베트남', '필리핀', '인도네시아', '말레이시아'] },
      { id: 'r3', name: '미주·유럽', places: ['미국', '캐나다', '멕시코', '영국', '프랑스', '독일'] },
      { id: 'r9', name: '그 외 지역', places: [], isDefault: true },
    ],
    HBA: [
      { id: 'r1', name: 'New York', places: ['미국 - 뉴욕'] },
      { id: 'r2', name: 'Major US Cities', places: ['미국 - 보스턴', '미국 - 시카고', '미국 - 샌프란시스코', '미국 - LA', '미국 - 마이애미', '미국 - 워싱턴 DC'] },
      { id: 'r3', name: 'Other US', places: ['미국 (그 외 도시)'] },
      { id: 'r4', name: 'Mexico City', places: ['멕시코 - 멕시코시티'] },
      { id: 'r5', name: 'Bogota', places: ['콜롬비아 - 보고타'] },
      { id: 'r6', name: 'United Kingdom', places: ['영국 전체'] },
      { id: 'r7', name: 'Korea / Japan', places: ['대한민국 전체', '일본 전체'] },
      { id: 'r9', name: 'Other International', places: [], isDefault: true },
    ],
    HBJ: [
      { id: 'r1', name: '일본(국내출장)', places: ['일본 전체 (도쿄·가나가와·지바·사이타마는 숙박 동반 + 담당 리더 사전 허가 시에만 국내출장)'] },
      { id: 'r2', name: '한국', places: ['대한민국 전체'] },
      { id: 'r3', name: '미국', places: ['미국 전체'] },
      { id: 'r4', name: '유럽', places: ['영국', '프랑스', '독일', '스페인', '이탈리아'] },
      { id: 'r9', name: '그 외 지역', places: [], isDefault: true },
    ],
    HBC: [], HBI: [],
  };
  regions.HBL = JSON.parse(JSON.stringify(regions.HBA));

  /* 여비규정 (법인별 개정 버전 목록, 최신순)
     item.type : 'class'(좌석·차량·객실 등급 텍스트) | 'cap'(한도 금액, 실비 지급) | 'flat'(정액 지급) | 'actual'(실비, 한도 없음)
     item.table: { colHead, cols:[label], rows:[{ label, cells:[값] }] }  — 등급별 차등이면 rows=등급, 지역별 차등이면 cols=지역 그룹
     cells 값이 null 이면 '미정의'(규정 문서에 값 없음) */
  const HBA_REGION_COLS = ['New York', 'Major US Cities', 'Other US', 'Mexico City', 'Bogota', 'United Kingdom', 'Korea / Japan', 'Other International'];
  const hbaItems = () => [
    { key: 'air', cat: '교통', name: '항공', on: true, type: 'class', byGrade: true, byRegion: false, cur: null, unit: '좌석 등급',
      table: { colHead: '비행 시간(경유·환승 대기 제외)', cols: ['5시간 미만', '5시간 이상'],
        rows: [ { label: 'Tier 1', cells: ['Business (미운영 시 First)', 'Business (미운영 시 First)'] }, { label: 'Tier 2', cells: ['Economy', 'Business'] }, { label: 'Tier 3', cells: ['Economy', 'Economy'] } ] },
      guide: '출발 14일 전까지 예약을 권장합니다. 아티스트 동행 시 아티스트와 동급으로 조정할 수 있으며 Finance 책임자의 사전 승인이 필요합니다.' },
    { key: 'rail', cat: '교통', name: '철도', on: true, type: 'class', byGrade: true, byRegion: false, cur: null, unit: '좌석 등급',
      table: { colHead: '', cols: ['좌석 등급'], rows: [ { label: 'Tier 1', cells: ['First'] }, { label: 'Tier 2', cells: ['Standard / Business'] }, { label: 'Tier 3', cells: ['Standard / Business'] } ] },
      guide: '위약 운임(penalty fare)은 회사가 부담하지 않습니다.' },
    { key: 'rental', cat: '교통', name: '렌터카', on: true, type: 'class', byGrade: true, byRegion: false, cur: null, unit: '차량 등급',
      table: { colHead: '', cols: ['차량 등급'], rows: [ { label: 'Tier 1', cells: ['Intermediate'] }, { label: 'Tier 2', cells: ['Intermediate'] }, { label: 'Tier 3', cells: ['Standard'] } ] },
      guide: '3인 이상 동행, 업무용 초과 수하물, 아티스트·고객 탑승 등의 경우 Full-size/SUV를 이용할 수 있습니다. 렌터카 이용 시 택시·라이드셰어 비용은 지급하지 않습니다.' },
    { key: 'hotel', cat: '숙박', name: '숙박', on: true, type: 'cap', byGrade: true, byRegion: true, cur: 'USD', unit: '1박 상한 (세금·수수료 포함)',
      table: { colHead: '지역 그룹', cols: HBA_REGION_COLS,
        rows: [ { label: 'Tier 1', cells: [600, 570, 440, 400, 350, 575, 420, 440] }, { label: 'Tier 2', cells: [480, 450, 380, 300, 250, 450, 350, 380] }, { label: 'Tier 3', cells: [400, 390, 350, 250, 200, 400, 300, 350] } ] },
      guide: '스탠다드 객실 이용이 원칙입니다. 항공권과 함께 온라인 예약 도구 또는 지정 여행사를 통해 예약해 주세요. Mexico City는 법인 협약 호텔(3곳)을 우선 이용합니다.' },
    { key: 'meal', cat: '일비·식비', name: '식비', on: true, type: 'cap', byGrade: false, byRegion: true, cur: 'USD', unit: '1인 1일 한도 (세금·팁 포함, 실비 지급)',
      table: { colHead: '지역 그룹', cols: HBA_REGION_COLS, rows: [ { label: '전체 구성원', cells: [100, 90, 75, 70, 60, 90, 75, 90] } ] },
      guide: '정액(per diem)이 아닌 실비 한도입니다. 구성원이 함께 식사한 경우 1인당 금액이 각자의 일 한도에 포함됩니다.' },
    { key: 'allowance', cat: '일비·식비', name: '출장 수당(일당)', on: false, type: 'flat', byGrade: false, byRegion: false, cur: 'USD', unit: '1일 정액',
      table: { colHead: '', cols: ['1일 지급액'], rows: [ { label: '전체 구성원', cells: [null] } ] }, guide: '' },
    { key: 'laundry', cat: '기타', name: '세탁비', on: true, type: 'cap', byGrade: false, byRegion: false, cur: 'USD', unit: '1일 한도 (실비 지급)',
      table: { colHead: '', cols: ['1일 한도'], rows: [ { label: '전체 구성원', cells: [20] } ] },
      cond: '출장 기간 10일 초과 시', guide: '영수증 첨부 시 한도 내 실비로 지급합니다.' },
    { key: 'telecom', cat: '기타', name: '통신비', on: true, type: 'cap', byGrade: false, byRegion: false, cur: 'USD', unit: '월 한도 (실비 지급)',
      table: { colHead: '', cols: ['월 한도'], rows: [ { label: '전체 구성원', cells: [100] } ] },
      cond: '출장 기간 10일 초과 시 현지 USIM 구매·이용료', guide: '기내 Wi-Fi는 기내 업무 수행 시 지급합니다. 공항 라운지 이용료는 지급하지 않습니다.' },
    { key: 'mileage', cat: '교통', name: '자가용(마일리지)', on: true, type: 'flat', byGrade: false, byRegion: false, cur: 'USD', unit: '1마일당 정액',
      table: { colHead: '', cols: ['1마일당'], rows: [ { label: '전체 구성원', cells: [0.7] } ] },
      guide: 'IRS 표준 마일리지 요율(2025년 기준)을 적용합니다. 통상 출퇴근 거리는 제외합니다.' },
  ];

  const policies = {
    HBA: [
      { ver: 'v4', status: 'active', title: 'HBA & HBL Travel & Expense Policy Update', from: '2025.12.15', to: '', doc: 'HBAHBL_TE_Policy_Update_December_2025.pdf', by: '윤채희', at: '2025.12.10', items: hbaItems() },
      { ver: 'v3', status: 'ended', title: 'HBA & HBL Travel & Expense Policy', from: '2024.07.01', to: '2025.12.14', doc: 'HBA_TE_Policy_2024.pdf', by: '서준석', at: '2024.06.20', items: null },
    ],
    HBL: [
      { ver: 'v2', status: 'active', title: 'HBA & HBL Travel & Expense Policy Update', from: '2025.12.15', to: '', doc: 'HBAHBL_TE_Policy_Update_December_2025.pdf', by: '윤채희', at: '2025.12.10', copiedFrom: 'HBA v4', items: hbaItems() },
    ],
    HBJ: [
      { ver: 'v3', status: 'scheduled', title: '出張旅費規程 (2027 개정안)', from: '2027.01.01', to: '', doc: 'HBJ-HR-006_出張旅費規程_20270101.pdf', by: '윤채희', at: '2026.11.05', items: null },
      { ver: 'v2', status: 'active', title: '出張旅費規程 (HBJ-HR-006)', from: '2024.03.29', to: '2026.12.31', doc: 'HBJ-HR-006_出張旅費規程_20240329.pdf', by: '서준석', at: '2024.03.25',
        items: [
          { key: 'air', cat: '교통', name: '항공', on: true, type: 'class', byGrade: true, byRegion: false, cur: null, unit: '좌석 등급',
            table: { colHead: '', cols: ['좌석 등급'], rows: [ { label: '리더그룹·SP 이상', cells: ['Business'] }, { label: '일반 구성원', cells: ['Economy'] } ] },
            guide: '아티스트 운영 담당자는 아티스트의 안전·보안을 위해 동급 좌석에 동승할 수 있습니다(항공기 1기당 1명, 추가 인원은 레이블 리더 승인). 해당 등급 이용이 곤란한 경우 CHRO 전결로 조정합니다.' },
          { key: 'rail', cat: '교통', name: '철도·버스', on: true, type: 'class', byGrade: true, byRegion: false, cur: null, unit: '좌석 등급',
            table: { colHead: '', cols: ['철도', '버스'], rows: [ { label: '리더그룹·SP 이상', cells: ['신칸센 그린샤', '일반'] }, { label: '일반 구성원', cells: ['일반', '일반'] } ] }, guide: '' },
          { key: 'rental', cat: '교통', name: '렌터카', on: true, type: 'class', byGrade: false, byRegion: false, cur: null, unit: '차량 등급',
            table: { colHead: '', cols: ['차량 등급'], rows: [ { label: '전체 구성원', cells: ['스탠다드형 또는 1일 ¥10,000 미만 차종'] } ] },
            cond: '해외 출장 중 대중교통·택시 이용이 곤란하거나 장기 출장인 경우', guide: '렌터카 보험은 렌터카 비용에 포함합니다. 해당 등급 이용이 곤란한 경우 담당 리더 전결이 필요합니다.' },
          { key: 'hotel', cat: '숙박', name: '숙박', on: true, type: 'cap', byGrade: false, byRegion: true, cur: 'JPY', unit: '1박 상한 (회사 지정 호텔 제외)',
            table: { colHead: '지역 그룹', cols: ['일본(국내출장)', '한국', '미국', '유럽', '그 외 지역'],
              rows: [ { label: '전체 구성원', cells: ['3~4성급 또는 ¥30,000 미만', '3~4성급 또는 ₩300,000 미만', '3~4성급 또는 ¥30,000 미만', '3~4성급 또는 ¥30,000 미만', '3~4성급 또는 ¥30,000 미만'] } ] },
            guide: '회사 지정 숙박처 이용이 원칙입니다. 민박·airbnb 등 개인 운영 숙박시설은 이용할 수 없습니다.' },
          { key: 'meal', cat: '일비·식비', name: '식비', on: true, type: 'cap', byGrade: false, byRegion: true, cur: 'JPY', unit: '1인 1일 한도 (실비 지급)',
            table: { colHead: '지역 그룹', cols: ['일본(국내출장)', '한국', '미국', '유럽', '그 외 지역'], rows: [ { label: '전체 구성원', cells: ['¥6,000', '₩60,000', 'US$60', 'US$60', null] } ] },
            guide: '외부 파트너·고객과의 식사 비용은 제외합니다(접대비는 담당 리더 사전 승인).' },
          { key: 'allowance', cat: '일비·식비', name: '출장 수당(일당)', on: true, type: 'flat', byGrade: false, byRegion: false, cur: 'JPY', unit: '1일 정액',
            table: { colHead: '', cols: ['1일 지급액'], rows: [ { label: '전체 구성원', cells: [5000] } ] },
            cond: '국내·해외 구분 없음. 오전 6시 기산 24시간 경과 시 1일분 발생', guide: '24시간 미만이라도 숙박을 동반하거나 왕복 이동 시간이 8시간 이상이면 지급합니다.' },
          { key: 'laundry', cat: '기타', name: '세탁비', on: true, type: 'cap', byGrade: false, byRegion: false, cur: 'JPY', unit: '1일 한도 (실비 지급)',
            table: { colHead: '', cols: ['1일 한도'], rows: [ { label: '전체 구성원', cells: [2000] } ] }, cond: '장기 출장(10일 이상 60일 미만)에 한함', guide: '비용 신청 시 증빙 자료를 첨부해야 합니다.' },
          { key: 'telecom', cat: '기타', name: '통신비', on: true, type: 'actual', byGrade: false, byRegion: false, cur: 'JPY', unit: '실비',
            table: { colHead: '', cols: ['지급 기준'], rows: [ { label: '전체 구성원', cells: ['음성 통화·데이터 로밍 실비 / 장기 출장 시 현지 USIM 월 US$100 이내'] } ] },
            guide: '사내 구성원 간 해외 통화는 Slack Call 등 보이스톡 사용을 기본으로 합니다.' },
        ] },
      { ver: 'v1', status: 'ended', title: '出張旅費規程 (제정)', from: '2020.07.14', to: '2024.03.28', doc: 'HBJ-HR-006_出張旅費規程_20200714.pdf', by: '서준석', at: '2020.07.10', items: null },
    ],
    HYB: [
      { ver: 'v5', status: 'active', title: '출장 여비 규정 (화면 예시용 샘플 값)', from: '2026.03.09', to: '', doc: 'HYB_출장여비규정_2026.pdf', by: '서준석', at: '2026.03.02',
        items: [
          { key: 'air', cat: '교통', name: '항공', on: true, type: 'class', byGrade: true, byRegion: false, cur: null, unit: '좌석 등급',
            table: { colHead: '비행 시간', cols: ['6시간 미만', '6시간 이상'], rows: [ { label: '임원', cells: ['Business', 'Business'] }, { label: '리더', cells: ['Economy', 'Premium Economy'] }, { label: '구성원', cells: ['Economy', 'Economy'] } ] }, guide: '' },
          { key: 'hotel', cat: '숙박', name: '숙박', on: true, type: 'cap', byGrade: true, byRegion: true, cur: 'KRW', unit: '1박 상한',
            table: { colHead: '지역 그룹', cols: ['국내', '일본·동남아', '미주·유럽', '그 외 지역'], rows: [ { label: '임원', cells: [250000, 350000, 500000, 400000] }, { label: '리더', cells: [180000, 280000, 400000, 320000] }, { label: '구성원', cells: [150000, 250000, 350000, 280000] } ] }, guide: '' },
          { key: 'meal', cat: '일비·식비', name: '식비', on: true, type: 'cap', byGrade: false, byRegion: true, cur: 'KRW', unit: '1인 1일 한도',
            table: { colHead: '지역 그룹', cols: ['국내', '일본·동남아', '미주·유럽', '그 외 지역'], rows: [ { label: '전체 구성원', cells: [40000, 70000, 90000, 80000] } ] }, guide: '' },
          { key: 'telecom', cat: '기타', name: '통신비', on: true, type: 'cap', byGrade: false, byRegion: false, cur: 'KRW', unit: '1일 한도', table: { colHead: '', cols: ['1일 한도'], rows: [ { label: '전체 구성원', cells: [15000] } ] }, guide: '' },
        ] },
    ],
    HBC: [], HBI: [],
  };

  /* 변경 이력 (최신순). cat: '기안 항목' | '여비규정' | '구성원 등급' | '지역 그룹' */
  const history = [
    { at: '2026.11.05 14:22', corp: 'HBJ', cat: '여비규정', text: 'v3 개정안 등록 — 적용 시작일 2027.01.01 (적용 예정)', by: '윤채희' },
    { at: '2026.10.27 10:05', corp: 'HBJ', cat: '기안 항목', text: '출장 예산 OFF → ON', by: '윤채희' },
    { at: '2026.10.27 10:05', corp: 'HBJ', cat: '기안 항목', text: '출장 근태 신청 OFF → ON', by: '윤채희' },
    { at: '2026.10.20 16:40', corp: 'HBA', cat: '기안 항목', text: '법인 최초 설정 — 출장 예산 OFF, 법인카드 한도 증액 OFF, 출장 근태 신청 OFF', by: '윤채희' },
    { at: '2026.10.20 16:38', corp: 'HBL', cat: '기안 항목', text: '법인 최초 설정 — 출장 예산 OFF, 법인카드 한도 증액 OFF, 출장 근태 신청 OFF', by: '윤채희' },
    { at: '2026.03.28 09:12', corp: 'HBJ', cat: '구성원 등급', text: '개인 예외 지정 추가 — 佐藤 美咲 (일반 구성원 → 리더그룹·SP 이상)', by: '서준석' },
    { at: '2026.02.24 11:30', corp: 'HBA', cat: '구성원 등급', text: '개인 예외 지정 추가 — Maria Santos (Tier 3 → Tier 2, ~2026.11.30)', by: '윤채희' },
    { at: '2025.12.22 15:02', corp: 'HBA', cat: '구성원 등급', text: '개인 예외 지정 추가 — Jordan Lee (Tier 3 → Tier 2)', by: '윤채희' },
    { at: '2025.12.10 17:45', corp: 'HBL', cat: '여비규정', text: 'v2 등록 (HBA v4에서 복사) — 적용 시작일 2025.12.15', by: '윤채희' },
    { at: '2025.12.10 17:20', corp: 'HBA', cat: '여비규정', text: 'v4 등록 — 적용 시작일 2025.12.15', by: '윤채희' },
    { at: '2025.12.10 16:58', corp: 'HBA', cat: '지역 그룹', text: '지역 그룹 추가 — Other US (식비 한도 구분용)', by: '윤채희' },
    { at: '2026.03.09 09:00', corp: 'HYB', cat: '기안 항목', text: '법인 최초 설정 — 출장 예산 ON, 법인카드 한도 증액 ON, 출장 근태 신청 ON', by: '서준석' },
  ];

  /* 인사정보 구성원 검색용 샘플 (개인 예외 지정 추가 모달) */
  const people = {
    HBA: [ { empNo: 'A100744', name: 'Chris Park', dept: 'Label Operations', hrTitle: 'Director' }, { empNo: 'A100802', name: 'Emily Chen', dept: 'Finance', hrTitle: 'Manager' }, { empNo: 'A100913', name: 'David Kim', dept: 'A&R', hrTitle: 'Senior Director' } ],
    HBL: [ { empNo: 'L300045', name: 'Sofía Ramírez', dept: 'Marketing', hrTitle: 'Manager' }, { empNo: 'L300078', name: 'Diego Torres', dept: 'Artist Development', hrTitle: 'Director' } ],
    HBJ: [ { empNo: 'J200145', name: '田中 健', dept: 'Concert Business', hrTitle: 'チーム員' }, { empNo: 'J200162', name: '鈴木 花', dept: 'Artist Management', hrTitle: '職責者' } ],
    HYB: [ { empNo: '10004684', name: '차영록', dept: '서비스전략팀(HYB)', hrTitle: '구성원' }, { empNo: '10003321', name: '김민지', dept: '뮤직라이츠실(HYB)', hrTitle: '구성원' } ],
    HBC: [ { empNo: 'C400012', name: '王 丽', dept: 'Business Development', hrTitle: 'Manager' } ],
    HBI: [ { empNo: 'I500007', name: 'Priya Sharma', dept: 'Operations', hrTitle: 'Manager' } ],
  };

  return { TODAY, admin: '차영록', hrSyncAt: '2026.11.12 06:00', corps, draftItems, grades, gradeExceptions, regions, policies, history, people,
    curSymbol: { KRW: '₩', USD: 'US$', JPY: '¥', CNY: 'CN¥', INR: '₹' } };
})();
