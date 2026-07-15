# Atlas Premiere · Aurora Traveler

Atlas Premiere는 Experience Atlas의 경로를 시간순으로 재구성해 오로라 여행자를 따라가는 기억 여행으로 재생한다. 짧은 편집본에서도 선택 범위의 모든 GPS 활동은 최종 지도에 남고, Full Chronicle에서는 모든 활동을 하나씩 Follow한다.

## 구현 범위 1–7

1. **기본 장면** — Prelude, 실제 GPS 위 Activity Follow, 완료 흔적 고정, 전체 Atlas Finale를 제공한다.
2. **Memory Jump** — 활동 사이에는 실제 이동 경로를 만들지 않는다. 가까운 전환, 지역 간 오로라 Arc, 60일 이상 Time Gap을 별도 장면으로 표시하며 거리·PNG·활동 상세에는 포함하지 않는다.
3. **재생 길이** — 약 60초 Memory Cut, 3분 Chronicle, 모든 활동 Follow를 제공한다. Memory Cut은 최대 12개 하이라이트를 Follow하고 나머지 활동은 시간순 Montage로 공개한다.
4. **기억 연출** — 같은 지역의 과거 활동 Echo Riders, 첫 기록 Territory Bloom, 원본 성과/Atlas 개인기록 Record Beacon, 계절색, 측정된 회복값만 사용하는 Recovery Aura를 제공한다.
5. **60초 스토리보드** — First Light → 하이라이트 Follow/Jump/Montage → 전체 공개 → Finale 순서로 구성한다.
6. **재생 UI** — 필터/전체 범위, 길이, 위치만 Follow/방향까지 Follow/Overview, 기억 레이어 토글, 재생·정지·장면 이동·탐색·Preset/Custom 속도, Free Look과 Follow 복귀, Finale의 다시 보기/PNG/Atlas 복귀를 제공한다.
7. **기술 원칙** — 실제 GPS와 기억 전환을 분리하고, 숨긴 활동을 제외하며, 센서·타임스탬프·회복값을 추정해 만들지 않는다. 타임스탬프가 없으면 `VISUALIZED PROGRESS`로 표시한다.

## 데이터 계약

- 입력 경로는 민감 위치 마스킹이 끝난 `AtlasRouteFeature`만 사용한다.
- 정렬 기준은 활동의 현지 날짜와 원본 날짜다.
- `Memory Jump`는 파생 시각 효과이며 경로 모델에 저장하지 않는다.
- Recovery Aura는 같은 날짜의 measured/derived 수면 점수, Body Battery, 스트레스만 사용한다. 신호가 없으면 표시하지 않는다.
- Record Beacon은 원본 성과와 Atlas 파생 개인기록을 시각적으로 구분한다.
- Premiere 범위는 현재 Atlas 필터 또는 전체 Atlas 중 사용자가 선택한다. 두 범위 모두 숨긴 활동을 제외한다.

## 상태 흐름

`setup → playing ↔ paused → complete → replay/PNG/exit`

- 지도에 직접 포인터·휠 입력이 들어오면 `freeLook=true`가 된다.
- `여행자 다시 따라가기`를 누르면 선택한 카메라 모드로 복귀한다.
- 움직임 줄이기 환경에서는 카메라·CSS 애니메이션을 즉시 전환 또는 정적 표현으로 낮춘다.
- 빈 GPS 범위에서는 시작 버튼을 비활성화하고 이유를 표시한다.

## Camera Lab · 2차 튜닝

- 재생 배속은 `0.25×, 0.5×, 0.75×, 1×, 1.25×, 1.5×, 2×, 3×, 4×, 8×` Preset과 `0.1×–16×` Custom 입력을 제공한다.
- `위치만 Follow`는 북쪽을 향한 지도를 유지하면서 여행자의 현재 위치만 추적한다.
- `방향까지 Follow`는 진행 방향을 추적하되 방향 반영률, 회전 완충 시간, 초당 최대 회전각, 고배속 회전 보정을 사용해 급격한 회전을 억제한다.
- `Activity 구간을 화면에 가득 맞춤`이 켜지면 활동 전체 Bounds를 카메라에 유지한다. 꺼지면 여행자 중심 Follow를 사용한다.
- 기본·최소·최대 배율을 Camera Lab에서 재생 전과 재생 중 모두 변경할 수 있다. 모든 값은 지도 엔진의 안전 범위에서 정규화한다.
- Memory Jump의 여행자와 잔상은 직선 보간이 아니라 화면에 표시된 Great-circle Arc의 경도·위도·고도를 그대로 따라간다.
- 기본 방향 Follow 값은 `55% 방향 반영`, `1.2초 완충`, `55°/s`, `65% 배속 보정`이며 실제 데이터 피드백으로 조정 가능하다.

## 검증 게이트

- [x] Story engine 단위 테스트: 시간순 공개, 전체 경로 포함, 하이라이트 상한, Memory Jump 비경로성, Full Chronicle 전체 Follow, measured recovery, 빈 입력.
- [x] Camera Lab 단위 테스트: Custom 배속 경계, Zoom 정규화, 최단 방향 회전, 최대 회전속도, 고배속 완충, Arc 고도 일치.
- [x] 정적 검사: ESLint 및 TypeScript.
- [x] 프로덕션 빌드.
- [x] 데스크톱 실브라우저: 설정, 재생, Activity Card, Memory Jump, Free Look/복귀, Finale, PNG 연결, 콘솔 오류 확인.
- [ ] 실제 활동에서 Camera Lab 기본값과 4×/8× 회전 감각 최종 사용자 튜닝.
- [ ] 배포 URL에서 모바일 실제 기기 확인: 390px 전후에서 설정 스크롤, HUD, 하단 컨트롤, Finale 버튼 터치 영역.
- [ ] 실제 대용량 Strava/Garmin ZIP으로 장시간 프레임 안정성과 메모리 확인.

## 완료 기준

- 선택 범위의 모든 GPS 활동이 최종 Atlas에 포함된다.
- 실제 경로와 Memory Jump를 사용자가 혼동하지 않는다.
- 필터와 숨김 상태가 Premiere와 PNG에 일관되게 적용된다.
- 누락 데이터는 연출 생략으로 저하되고 가짜 값으로 대체되지 않는다.
- Premiere 종료 뒤 기존 Atlas 카메라와 조작 기능으로 안전하게 복귀한다.
