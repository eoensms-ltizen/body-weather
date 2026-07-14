# Body Weather 운영·Analytics 계획

## 결정

초기 운영은 **Plausible Analytics + Sites 접근 제어** 조합을 권장한다.

- Plausible은 쿠키·교차 사이트 추적·지속 사용자 ID 없이 집계 분석과 Custom Event를 제공한다.
- Cloudflare Web Analytics는 무료 페이지뷰·성능 보조 지표로는 좋지만 현재 Custom Event를 지원하지 않아 ZIP 시도·완료 퍼널의 단독 도구로는 부족하다.
- Umami는 Custom Event와 자체 호스팅이 필요할 때 좋은 대안이다. 단, 이 서비스에서는 화면에 경로가 나타나므로 Session Replay·Heatmap은 반드시 끈다.

참고: https://plausible.io/docs/custom-event-goals, https://plausible.io/docs/compliance, https://developers.cloudflare.com/web-analytics/faq/, https://docs.umami.is/docs/event-data

Plausible 계정과 사이트 도메인이 연결되기 전에는 Analytics가 완전히 비활성화된다. 활성화할 때 `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`만 배포 환경에 설정한다.

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
