# Verification report

검증일: 2026-07-14 (Asia/Seoul)

## 기준선

- 기존 타입 검사, 단위 테스트 21개, 프로덕션 빌드가 통과한 상태에서 시작했습니다.
- 기존 가져오기·보안·결측 테스트를 삭제하거나 assertion을 낮추지 않았습니다.

## 실제 ZIP 읽기 전용 인벤토리

정확한 위치, 활동명, 건강 원본값은 기록하지 않습니다.

| 소스 | 압축 크기 | 엔트리 | 지원/관련 엔트리 | 미디어 제외 | 관측 범위 |
| --- | ---: | ---: | ---: | ---: | --- |
| Strava | 2.44 GB | 4,829 | 2,460 | 2,291 | 2016-08-05 ~ 2026-07-12 |
| Garmin | 24.1 MB | 123 | 21 | 3 | 민감 원본 날짜 미기재 |

Strava `activities.csv`에는 2,474개 활동과 2,474개 경로 참조가 있었고 103개 헤더 중 중복 이름 5개를 확인했습니다. `Achievement Count` 유효 행은 0개였으므로 KOM/QOM/PR을 생성하지 않고 파생 개인기록만 사용합니다. 원본 ZIP은 변경하지 않았습니다.

자동 Chrome의 파일 선택 API는 로컬 경로 연결을 운영체제 보안으로 거부했습니다. 실제 구조·집계는 읽기 전용 인벤토리로 확인했고, 브라우저 가져오기 이후의 핵심 흐름은 동일 파서 모델을 쓰는 합성 full fixture로 검증했습니다. 사용자가 직접 파일 선택기를 사용하면 원본 ZIP 경로를 정상 선택할 수 있습니다.

## Gate A–H

| Gate | 결과 | 증거 |
| --- | --- | --- |
| A 기준선 | 통과 | 타입, 21 unit, build |
| B import/security | 통과 | 미디어 제외, ZIP path/size/ratio, partial source tests |
| C Atlas | 통과 | MapLibre/deck.gl, Worker, 3 LOD, grid index, 필터, drawer, fallback |
| D privacy/achievement | 통과 | 250m/3회 후보, 300m mask, source achievement와 derived 분리 |
| E Forecast | 통과 | robust baseline, stale label, confidence/Tier, no future leakage, 4 scenarios |
| F Memories/Poster | 통과 | evidence cards, 3 ratios, 4K PNG, no external tile, privacy default |
| G UX/quality | 통과 | desktop/mobile Chrome render, axe critical/serious 0, route interaction |
| H privacy/deploy | 배포 후 갱신 | README/docs, local-first copy, production smoke 예정 |

## 실행 명령과 최근 결과

```text
npm run typecheck       PASS
npm run lint            PASS
npm run test:unit       PASS · 34/34
npm run test:browser    PASS · Atlas→drawer→Forecast→Memories→Data
npm run test:visual     PASS · 1440×900, 390×844
npm run test:a11y       PASS · axe critical/serious 0
npm run test:performance PASS · Chrome ready 및 2,400 route benchmark
npm run build           PASS
```

시각 캡처는 합성 경로만 사용합니다. 실제 Chrome 확장 세션에서는 OpenFreeMap 베이스맵 위 glowing route, 경로 상세 drawer, stale Forecast, 시나리오 변화, Memories, 4K Poster 5.1MB 생성을 확인했습니다. Headless Chrome은 외부 타일 차단 상황에서 로컬 fallback을 검증했습니다.

## 성능

테스트 환경은 Windows, Google Chrome 2026-07-14 설치본, Node 24.12입니다. headless Chrome의 외부 지도 차단 fallback을 포함한 상호작용 준비는 8.7초였습니다. 실제 Chrome 확장 세션에서 타일과 경로는 약 2~3초 내 표시됐습니다. 2,400경로/약 192,000 합성 point의 Atlas 계산은 2.776초였습니다. 실제 전체 이력 계산은 Web Worker에서 실행됩니다.

## 알려진 제한 및 차단

- 로그인/API는 이번 범위가 아니며 ZIP 파일 선택이 필요합니다.
- 실제 KOM/QOM/PR 종류는 Strava 원본에 명시적 근거가 없으면 표시할 수 없습니다.
- 지오코딩을 하지 않아 중립 지역 라벨을 사용합니다.
- headless 환경의 외부 타일은 차단될 수 있으나 경로 fallback과 Poster는 영향받지 않습니다.
- `npm audit`의 고위험 항목은 Cloudflare/Vite 도구 업데이트로 제거했습니다. Next 16.2.6 내부 PostCSS에 중간 등급 2건이 남았고, npm의 자동 해법은 Next 9.3.3으로 강제 하향하므로 적용하지 않았습니다. 앱은 사용자 제공 CSS를 stringify하지 않습니다.
