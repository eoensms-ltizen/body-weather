# Body Weather — Experience Atlas

Body Weather는 Strava와 Garmin 내보내기 ZIP을 브라우저 안에서 읽어 평생의 운동 경로, 회복 신호, 개인 기록을 하나의 시각적 경험으로 엮는 로컬 우선 웹 앱입니다.

![Body Weather Experience Atlas social preview](public/og-atlas.png)

## 제품 흐름

- **Atlas**: MapLibre GL 베이스맵과 deck.gl 경로 레이어로 모든 유효 경로를 겹쳐 봅니다. 전체/최근 3개월/연도/직접 날짜/종목 필터와 Memory·Sport·Season·Effort·Heart·Power·Records 색상 모드를 제공합니다.
- **Forecast**: 최신 측정일의 수면·HRV·안정시 심박·Body Battery·스트레스·최근 운동 부하를 개인 기준선과 비교합니다. 오래된 데이터는 오늘이 아니라 `마지막 관측`으로 표시합니다.
- **Memories**: 첫 활동, 자주 찾은 지역, 계절, 원본 성과 및 Atlas 개인기록을 실제 활동 근거에 연결합니다.
- **Poster Studio**: 16:9 4K, 4:5, 9:16 PNG를 외부 지도 없이 Canvas에서 생성합니다. 민감 위치 마스킹이 항상 기본 적용되고 GPS/EXIF 메타데이터를 넣지 않습니다.
- **Data & Privacy**: 실제 보유 필드에 따른 Capability, 제외 미디어, 복구 가능한 오류와 네트워크 경계를 보여줍니다.

Strava만, Garmin만, 둘 다, 일부 필드 누락 모두 허용합니다. 사용할 수 없는 기능은 숨기거나 `측정 없음`으로 낮추며 빈 값을 `0`으로 만들지 않습니다.

## 실행

필요 환경은 Node.js 22.13 이상이며, Chrome 기반 품질 검증은 로컬 Google Chrome을 사용합니다.

```bash
npm install
npm run dev
```

`http://localhost:3000`에서 Strava/Garmin ZIP을 하나 또는 함께 선택합니다. 기본값은 전체 기간이며 기간 지정을 선택할 수도 있습니다.

프로덕션 빌드:

```bash
npm run build
npm run start
```

## 검증

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:browser
npm run test:visual
npm run test:a11y
npm run test:performance
npm run build
npm test
```

브라우저 계열 스크립트는 별도 포트에서 개발 서버를 띄우고 설치된 Chrome을 headless 모드로 조작합니다. 합성 데이터는 개발 환경의 `http://localhost:3000/?__fixture=full`에서만 켜지며 배포 환경에서는 활성화되지 않습니다. 자동 검증 결과는 [검증 보고서](docs/verification-report.md)에 기록합니다.

## 지원 데이터와 점진적 기능 저하

Strava:

- `activities.csv`
- GPX, FIT, `.gpx.gz`, `.fit.gz`
- 날짜, 종목, 이름, 시간, 거리, 고도, 칼로리, 심박, Relative Effort, 파워, Training Load, Intensity, Achievement Count

Garmin:

- 수면, HRV, 안정시 심박, Body Battery, 스트레스, 호흡, 걸음, 칼로리, 수분 등 Garmin Connect 내보내기의 인식 가능한 JSON
- 파일명 전체보다 의미 있는 이름 패턴과 실제 JSON 필드를 함께 탐지

사진·영상은 엔트리 메타데이터만 보고 제외하며 압축 해제하지 않습니다. 손상되거나 알 수 없는 개별 파일은 격리하고 다른 정상 데이터로 계속 진행합니다. 경로가 없으면 지도 대신 날짜·거리·회복 기반 Forecast와 Memories를 제공합니다. 웰니스가 없으면 Forecast를 운동 부하 Tier C 이하로 낮춥니다.

## 지도와 네트워크 개인정보

기본 지도 스타일은 [OpenFreeMap](https://openfreemap.org/)을 사용하며 지도 데이터 저작권 표시는 앱 안에 유지합니다. 지도 타일 요청에는 현재 보고 있는 영역과 네트워크 정보가 공급자에게 전달될 수 있지만, 원본 ZIP·건강값·GPS 경로 좌표는 요청 본문이나 쿼리로 보내지 않습니다. 타일이 실패하거나 8초 안에 준비되지 않으면 로컬 어두운 배경으로 전환하고 경로는 계속 표시합니다.

Poster Studio는 `경로만`과 `지도 포함` 배경을 선택할 수 있습니다. 모든 출력 비율은 Web Mercator 동일 축척의 contain 투영을 사용하므로 경로를 가로·세로로 따로 늘리지 않습니다. 지도 포함 내보내기에서 타일을 불러오지 못해도 경로 배경 PNG로 자동 저장하며, 숨긴 활동은 두 방식 모두 제외합니다.

경로 모델과 세 가지 LOD, bounds, 장소 클러스터, 0.25도 격자 공간 인덱스는 Web Worker에서 계산합니다. 필터는 원본 경로를 다시 수정하지 않고 완성된 모델의 부분집합을 사용합니다.

## 성과 근거 규칙

- 원본 `Achievement Count`가 있으면 `원본 성과`로 표시하지만, 내보내기에 종류와 세그먼트 근거가 없으므로 KOM/QOM/PR이라고 추측하지 않습니다.
- 최장 거리·최장 이동 시간 등은 `Atlas 개인기록`으로 별도 표시하고 `derived`, 원본 필드, 계산 버전을 기록합니다.
- 제공된 실제 Strava 내보내기에는 Achievement Count 행이 없었으므로 KOM을 생성하지 않았습니다.

## Forecast 계산 개요

기준일 이전 최대 28일만 개인 기준선으로 사용하며 미래 날짜는 읽지 않습니다. HRV와 안정시 심박은 median/MAD 기반 robust normalization, 수면·Body Battery·스트레스는 측정 점수, 운동은 최근 3일 부하와 이전 26일을 비교합니다. 기본 가중치는 수면 24%, HRV 20%, Body Battery 20%, 최근 부하 16%, 안정시 심박 10%, 스트레스 10%이며 없는 신호의 가중치는 관측된 신호에 다시 분배합니다.

신뢰도는 건강 신호 수, 기준선 일수, 최신성으로 결정합니다. 오늘과 1일 이내 데이터만 `오늘/내일`로 표현하며, 오래되면 `마지막 관측/다음 날 시뮬레이션`으로 바꿉니다. 결과는 개인 기록의 설명적 신호이며 의료 진단이나 확정 훈련 처방이 아닙니다. 자세한 내용은 [Forecast 방법](docs/forecast-method.md)에 있습니다.

## 개인정보와 보안

- ZIP과 건강·GPS 원본은 현재 브라우저에서만 처리하며 서버 저장소, 분석 API, D1/R2로 보내지 않습니다.
- 절대경로, `..`, 드라이브 경로와 NUL 문자가 있는 엔트리를 거부하고 크기·압축률 제한을 적용합니다.
- 반복 출발·도착 후보가 세 번 이상 250m 안에 모이면 반경 300m를 지도와 Poster에서 마스킹합니다.
- 새 ZIP을 누르면 메모리 상태를 버리고, 새로고침하면 모든 가져온 데이터가 사라집니다.
- 256MB 이하 입력만 SHA-256을 계산합니다. 더 큰 입력은 전체 메모리 복사를 피하기 위해 크기와 수정시각 식별자를 사용합니다.

자세한 경계와 삭제 방식은 [개인정보 문서](docs/privacy.md)를 참고하세요.

## 주요 코드

- `lib/importer.ts`: 대용량 ZIP 오케스트레이션과 소스 격리
- `lib/security.ts`: ZIP 안전 정책과 미디어 제외
- `lib/strava.ts`, `lib/garmin.ts`: 포맷 파서와 결측 보존
- `lib/atlas.ts`, `lib/atlas.worker.ts`: LOD, privacy, 성과, 장소, 공간 인덱스
- `lib/forecast.ts`: 결정적 Forecast 엔진
- `lib/memories.ts`, `lib/poster.ts`: Memory와 메타데이터 없는 고해상도 PNG
- `app/AtlasMap.tsx`: MapLibre/deck.gl 지도와 안전한 베이스맵 폴백

## 알려진 제한

- ZIP 내보내기는 브라우저 파일 선택 권한이 필요하며 로그인/API 연동은 후속 단계입니다.
- Strava 거리 단위는 내보내기 프로필에 의존합니다.
- 일반 Strava 내보내기만으로 KOM/QOM/PR 종류와 세그먼트 위치를 확정할 수 없습니다.
- 장소 이름을 별도 지오코딩하지 않습니다. 활동명이 없으면 중립적인 지역 라벨을 사용합니다.
- 지도 타일 네트워크가 차단되면 도로·지명 없이 경로만 표시됩니다.
- npm 감사 경고는 배포 전 [검증 보고서](docs/verification-report.md)에 현재 상태를 기록합니다.

## 라이선스

MIT
