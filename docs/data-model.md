# Data model

현재 계산 버전은 `1.0.0`입니다. 모든 측정·파생 값은 `MetricValue`의 `value`, `unit`, `status`, `source`, `sourceFile`, `confidence`, `calculationVersion`을 유지합니다.

## 결측 상태

| 상태 | 의미 |
| --- | --- |
| `measured` | 원본에서 직접 읽은 값 |
| `derived` | 원본 값으로 결정적으로 계산한 값 |
| `estimated` | 불완전한 근거로 제한적으로 추정한 값 |
| `missing` | 기대할 수 있으나 제공되지 않은 값 |
| `not_applicable` | 해당 활동·소스에 적용되지 않는 값 |
| `invalid` | 값이 있었지만 타입·범위 검증을 통과하지 못한 값 |

`null`과 `0`은 다릅니다. UI는 `null`을 `측정 없음`으로 보여 주며 계산 분모에도 포함하지 않습니다.

## Atlas 엔터티

- `AtlasRouteFeature`: 원본 Activity 참조, bounds, centroid, raw point count, 저/중/고 LOD, 마스킹 여부.
- `PrivacyZone`: 반복 출발·도착에서 계산한 중심, 반경, 근거 개수.
- `Achievement`: `source-confirmed`와 `derived`를 구분하고 원본 파일·필드·계산 버전을 기록.
- `PlaceCluster`: 18km 안의 경로 중심을 중립 지역 경험으로 묶음.
- `RouteSpatialIndex`: 0.25도 격자 셀에서 경로 ID를 찾는 직렬화 가능한 인덱스.
- `AtlasModel`: 유효 경로, 전체 bounds, privacy, achievements, places, spatial index와 집계.

경로는 `isValidRoutePoint`에서 위도 -85~85, 경도 -180~180과 유한 숫자를 검증합니다. Douglas–Peucker 단순화는 복사본을 만들며 원본 `RoutePoint[]`를 수정하지 않습니다. AtlasModel은 브라우저 Web Worker에서 만들어 메인 UI 정지를 줄입니다.

## Forecast 엔터티

- `ForecastFactor`: 정규화 점수, 재분배된 가중치, 상태, source, 기준선 일수, 설명.
- `ForecastSnapshot`: 기준일, 오늘/최근 관측 모드, 점수·범위·날씨 상태, 권장 밴드, confidence, Tier, 가정과 계산 버전.
- Tier A~E는 사용 가능한 건강 신호와 활동 부하의 조합을 나타낼 뿐 사용자 등급이 아닙니다.

## Memory 엔터티

`MemoryCard`는 kind, 실제 활동 ID 목록, 날짜 또는 지도 좌표, evidence, source field, calculationVersion을 유지합니다. 카드에서 Atlas로 이동할 때 날짜 범위와 위치만 바꾸며 원본 활동을 복제하지 않습니다.
