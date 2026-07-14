# Body Weather 운영·Analytics 계획

## 결정

초기 운영은 **Plausible Analytics + Sites 접근 제어** 조합을 권장한다.

- Plausible은 쿠키·교차 사이트 추적·지속 사용자 ID 없이 집계 분석과 Custom Event를 제공한다.
- Cloudflare Web Analytics는 무료 페이지뷰·성능 보조 지표로는 좋지만 현재 Custom Event를 지원하지 않아 ZIP 시도·완료 퍼널의 단독 도구로는 부족하다.
- Umami는 Custom Event와 자체 호스팅이 필요할 때 좋은 대안이다. 단, 이 서비스에서는 화면에 경로가 나타나므로 Session Replay·Heatmap은 반드시 끈다.

참고: https://plausible.io/docs/custom-event-goals, https://plausible.io/docs/compliance, https://developers.cloudflare.com/web-analytics/faq/, https://docs.umami.is/docs/event-data

Plausible 계정과 사이트별 스크립트가 연결되기 전에는 Analytics가 완전히 비활성화된다. 활성화할 때 Plausible의 **Site Settings → General → Site Installation**에서 `https://plausible.io/js/pa-XXXXX.js` 형태의 사이트별 URL을 복사해 배포 환경의 `NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL`에 설정한다. 2025년 10월 이전의 범용 `script.js` 방식은 호환용으로만 남기며, 새 연동에서는 `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`이 필요 없다.

### 소유자가 해야 할 일

1. Plausible Cloud의 30일 무료 체험 계정을 만들고 실제 배포 도메인을 Site로 추가한다.
2. Site Installation에서 사이트별 `pa-XXXXX.js` URL을 복사한다. 전체 `<script>` 태그나 계정 비밀번호/API 키는 공유하지 않는다.
3. 배포 환경에 `NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL`을 설정하고 재배포한다.
4. Plausible의 설치 검증 도구로 페이지뷰 요청을 확인한다.
5. 아래 6개 Custom Event를 Goal로 추가하고, 실제 ZIP 한 번으로 Import Started → Completed → Atlas Ready → Poster Exported 흐름을 확인한다.

Starter에서도 페이지뷰와 기본 Custom Event Goal은 사용할 수 있다. 이벤트 속성별 분석과 Funnel이 필요해질 때 Business를 검토한다. Custom Event도 월 사용량에 포함되므로 초기에는 아래 allowlist 이외의 이벤트를 늘리지 않는다.

## 전송 허용 이벤트

| 이벤트 | 목적 | 허용 속성 |
|---|---|---|
| Import Started | ZIP 분석 시도 수 | ZIP 크기 구간, 파일 수 구간 |
| Import Completed | 성공률·완료 퍼널 | 처리시간 구간, 활동 수 구간 |
| Import Failed | 실패율 | 사전 정의 오류 분류만 |
| Atlas Ready | Atlas 후처리 성능 | 처리시간 구간, 경로 수 구간 |
| Atlas Mode Used | 기능 사용성 | navigate/poster/hide |
| Poster Exported | 핵심 결과 도달률 | 비율, 전체/선택영역, 경로 수 구간 |

모든 숫자는 `under_10`, `100_999`, `1_3m` 같은 구간값으로 전송한다.

## 절대 수집 금지

- ZIP·CSV·FIT·GPX 파일명 또는 파일 내용
- 활동명, 활동 날짜·시간, 정확한 활동 수
- GPS 좌표, 지도 중심, 선택 영역, 도시·지역명
- 심박, 파워, 수면, HRV, Body Battery 등 건강·운동 측정값
- Strava/Garmin 계정 ID, 이메일, 사용자 ID
- ZIP 해시, 광고 ID, 브라우저 지문
- 원문 오류 메시지와 Stack Trace
- Session Replay, 화면 녹화, Heatmap

새 이벤트는 위 금지목록 검토와 코드의 enum/allowlist 추가 없이는 배포하지 않는다.

## 운영 도구 설계

운영 도구는 공개 Body Weather 안에 관리자 비밀키를 넣지 않고, 별도의 **owner-only Ops Console**로 만든다.

### 화면

1. **Overview**: 방문, Import 시도/성공/실패, Atlas Ready, Poster 완료, 7일·30일 추이
2. **Reliability**: 크기 구간별 성공률, 처리시간 구간, 사전 정의 오류 코드
3. **Release**: 현재 배포 버전, 직전 정상 버전, 롤백 실행
4. **Service Control**: Public / Maintenance / Private 전환과 2단계 확인
5. **Privacy Audit**: 실제 허용 이벤트·속성 목록, Analytics 연결 상태, 최근 설정 변경

### 서비스 상태

| 상태 | 사용자 화면 | 용도 |
|---|---|---|
| Public | 정상 공개 | 일반 운영 |
| Maintenance | 안내 페이지만 공개 | 계획 점검·장애 공지 |
| Private | 소유자만 접근 | 즉시 서비스 종료·보안 대응 |
| Rolled Back | 직전 정상 버전 공개 | 배포 장애 복구 |

### 종료 Runbook

1. 긴급 상황에서는 Sites 접근 모드를 owner-only로 바꿔 즉시 외부 접근을 차단한다.
2. Analytics 스크립트 환경값을 제거해 신규 이벤트 전송을 중단한다.
3. 원인을 확인하고 필요하면 직전 정상 버전으로 롤백한다.
4. 재공개 전 ZIP 로컬 처리, 지도 네트워크, 금지 이벤트, 모바일 흐름을 다시 검증한다.
5. Analytics 보존기간은 초기 90일을 권장하고 운영 목적이 끝난 집계는 삭제한다.

## 구현 순서

- Phase A(현재): 익명 이벤트 allowlist, Analytics 미연결 시 완전 비활성, Sites Public/Private 긴급 스위치
- Phase B: Plausible 계정 연결, Goals 6개 생성, 7일 성공률 대시보드
- Phase C: 별도 owner-only Ops Console, Maintenance 전환, 버전 롤백, 변경 감사로그
- Phase D: 트래픽이 커질 때만 Cloudflare Web Analytics를 성능 지표 보조로 추가

공개 앱에 운영 API 토큰을 포함하거나 `/ops`를 단순 URL 비공개 방식으로 보호해서는 안 된다.
