# Body Weather

Body Weather는 Strava와 Garmin 내보내기 ZIP을 브라우저 안에서 읽어 운동, 수면, HRV, 스트레스와 Body Battery를 개인의 “운동·회복 기후”로 보여주는 로컬 우선 웹 앱입니다.

![Body Weather social preview](public/og.png)

## 핵심 특징

- Strava 또는 Garmin ZIP 하나만 있어도 가능한 기능을 자동 구성합니다.
- 2GB를 넘는 ZIP도 전체 파일을 메모리에 올리지 않고 ZIP 중앙 디렉터리와 필요한 엔트리만 읽습니다.
- CSV의 중복 헤더와 비어 있는 필드를 안전하게 정규화합니다.
- GPX, FIT, gzip 경로를 읽어 Canvas 기반 운동 경로 흐름으로 표시합니다.
- Garmin 수면, HRV, Body Battery, 스트레스, 안정시 심박, 호흡, 걸음, 칼로리 및 수분 기록을 날짜별로 결합합니다.
- 누락값을 숫자 `0`으로 위조하지 않고 `measured`, `derived`, `estimated`, `missing`, `not_applicable`, `invalid` 상태로 구분합니다.
- 실제 데이터 보유량으로 Capability Profile을 만들고 사용할 수 없는 레이어는 숨기거나 부분 기능으로 낮춥니다.
- Personal Climate, 날짜/활동 상세, Correlation Lab, Data Map을 제공합니다.
- 업로드된 파일과 건강 원본을 서버에 전송하거나 영구 저장하지 않습니다.

## 실행

필요 환경: Node.js 22.13 이상

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 열고 Strava/Garmin 내보내기 ZIP을 선택합니다.

프로덕션 빌드:

```bash
npm run build
npm run start
```

## 검증

```bash
npm run typecheck
npm run test:unit
npm run lint
npm test
```

`npm test`는 타입 검사, 데이터 엔진 테스트, 16개 결손/오류 시나리오, 프로덕션 빌드 및 서버 렌더 검사를 실행합니다.

로컬 브라우저 검증용 합성 데이터는 개발 서버에서만 다음 URL로 활성화할 수 있습니다.

```text
http://localhost:3000/?__fixture=full
```

실제 사용자 데이터나 위치는 이 픽스처에 포함되지 않습니다. `localhost`가 아닌 배포 환경에서는 활성화되지 않습니다.

## 지원 데이터

### Strava

- `activities.csv`
- GPX
- FIT
- `.gpx.gz`, `.fit.gz`
- 활동 날짜, 종목, 이름, 운동/이동 시간, 거리, 칼로리, 심박, Relative Effort, 평균·가중·최대 파워, Training Load, Intensity

### Garmin

- `sleepData.json`
- `healthStatusData.json`
- `UDSFile.json`
- `HydrationLogFile.json`
- 수면 단계·점수·회복 점수, HRV, 안정시 심박, Body Battery, 스트레스, 피부 온도 편차, 호흡, 걸음, 칼로리, 수분 섭취와 추정 땀 손실

파일명 전체가 일치하지 않아도 의미 있는 이름 패턴과 실제 JSON 필드를 탐지합니다. 손상된 개별 파일은 격리하고 다른 정상 소스의 분석을 계속합니다.

## 개인정보와 보안

- 파일 내용은 브라우저 메모리에서만 처리합니다.
- D1, R2, 외부 분석 API 또는 서버 업로드를 사용하지 않습니다.
- 사진, 영상, 미디어 파일은 읽거나 추출하지 않습니다.
- 절대경로, `..`, 드라이브 경로, NUL 문자가 포함된 ZIP 엔트리를 거부합니다.
- 지원 파일에 엔트리 크기, 전체 크기, 압축률 제한을 적용합니다.
- 대용량 미디어는 처리 대상이 아니므로 압축 해제하지 않고 메타데이터만 건너뜁니다.
- 지도는 원본 좌표를 서버로 보내지 않습니다. 공개 화면 공유 전에는 사용자가 시작·종료 지점 노출 여부를 직접 확인해야 합니다.

256MB 이하 입력은 브라우저에서 SHA-256을 계산합니다. 더 큰 입력은 브라우저가 전체 파일을 메모리에 올리지 않도록 파일 크기와 수정시각을 무결성 식별자로 사용합니다.

## Adaptive Data Engine

```text
ZIP 안전 검사
→ 지원 파일 탐지
→ 포맷별 파싱
→ 공통 데이터 모델 정규화
→ 날짜별 웰니스 결합
→ Capability Profile 생성
→ 가능한 분석만 계산
→ 가능한 UI 레이어만 구성
```

주요 코드:

- `lib/importer.ts`: 대용량 ZIP 오케스트레이션과 소스 격리
- `lib/security.ts`: ZIP 보안 정책과 미디어 제외
- `lib/strava.ts`: CSV/GPX/FIT/gzip 처리
- `lib/garmin.ts`: Garmin 웰니스 JSON 처리
- `lib/analytics.ts`: Capability Profile, 활동 매칭, 상관관계와 회복 구성
- `lib/types.ts`: 출처와 결측 상태를 보존하는 공통 모델
- `app/BodyWeatherApp.tsx`: 적응형 사용자 경험

## 상관관계 해석

Correlation Lab은 최소 5개의 측정된 날짜쌍이 있을 때 Pearson 상관계수와 Fisher 변환 기반 95% 구간을 표시합니다. 이 결과는 개인 데이터 안에서 함께 움직인 신호를 설명할 뿐, 의학적 진단·인과관계·훈련 처방을 의미하지 않습니다.

## 알려진 제한사항

- Strava의 거리 단위는 내보내기 프로필의 사용자 단위를 따릅니다. 현재 UI는 일반적인 km 내보내기를 기본 표시합니다.
- Garmin의 모든 역사적 포맷을 완전히 열거하지 않습니다. 인식하지 못한 포맷은 Data Map에서 진단하고 정상 데이터는 유지합니다.
- 활동 매칭은 두 플랫폼의 활동 요약이 모두 있을 때만 수행합니다. 현재 기본 Garmin 웰니스 ZIP처럼 운동 상세가 별도 중첩 ZIP에만 있을 경우 Strava 활동을 중심으로 표시합니다.
- 매우 오래된 브라우저에서 `DecompressionStream`이 없으면 gzip 경로만 제외되고 활동 요약은 유지됩니다.
- `next`가 포함하는 PostCSS 버전에 중간 등급의 빌드 도구 권고가 남아 있습니다. 앱은 사용자 CSS를 생성하지 않으며 강제 수정은 프레임워크를 호환되지 않는 버전으로 낮추므로 적용하지 않았습니다.

## 확장 방법

새 소스는 다음 순서로 추가합니다.

1. 소스 어댑터에서 파일 패턴과 런타임 스키마를 확인합니다.
2. 원본 값을 `MetricValue<T>`로 변환하고 단위·상태·출처·신뢰도를 기록합니다.
3. `buildCapabilityProfile`에 새 기능 조건을 추가합니다.
4. 전체/부분/누락 픽스처를 추가합니다.
5. 누락값이 `0`으로 바뀌지 않는지 검증합니다.

## 라이선스

MIT
