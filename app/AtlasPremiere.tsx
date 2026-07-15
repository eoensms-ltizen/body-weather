"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clampPremiereSpeed, DEFAULT_PREMIERE_CAMERA_TUNING, normalizePremiereCameraTuning, type PremiereCameraTuning } from "@/lib/premiere-camera";
import { buildPremiereStory, premiereFrameAt, premiereSceneStart, type PremiereCameraMode, type PremiereLength, type PremiereMapState, type PremiereSettings } from "@/lib/premiere";
import type { Achievement, AtlasRouteFeature, DailyWellness, PlaceCluster } from "@/lib/types";

type PremiereStatus = "setup" | "playing" | "paused" | "complete";
type PremiereScope = "filter" | "all";
const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8] as const;

function durationLabel(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}분 ${String(seconds).padStart(2, "0")}초` : `${seconds}초`;
}

function metric(value: number | null | undefined, unit: string, digits = 0): string | null {
  return value === null || value === undefined ? null : `${value.toLocaleString("ko-KR", { maximumFractionDigits: digits })}${unit}`;
}

function TuningControl({ label, value, min, max, step, suffix, disabled, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return <label className="premiere-tuning-control" aria-disabled={disabled}>
    <span>{label}<b>{value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}{suffix}</b></span>
    <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
    <input type="number" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
  </label>;
}

function SpeedControl({ speed, custom, compact = false, onSpeedChange, onCustomChange }: {
  speed: number;
  custom: boolean;
  compact?: boolean;
  onSpeedChange: (value: number) => void;
  onCustomChange: (value: boolean) => void;
}) {
  return <div className={`premiere-speed-control${compact ? " compact" : ""}`}>
    <select aria-label="Premiere 재생 속도" value={custom ? "custom" : String(speed)} onChange={(event) => {
      if (event.target.value === "custom") {
        onCustomChange(true);
        return;
      }
      onCustomChange(false);
      onSpeedChange(clampPremiereSpeed(Number(event.target.value)));
    }}>
      {SPEED_PRESETS.map((preset) => <option key={preset} value={preset}>{preset}×</option>)}
      <option value="custom">Custom</option>
    </select>
    {custom && <input aria-label="Custom Premiere 재생 속도" className="premiere-custom-speed" type="number" min={0.1} max={16} step={0.05} value={speed} onChange={(event) => onSpeedChange(clampPremiereSpeed(Number(event.target.value)))} />}
  </div>;
}

export default function AtlasPremiere({
  open,
  filteredRoutes,
  allRoutes,
  achievements,
  placeClusters,
  wellness,
  filterActive,
  filterLabel,
  freeLook,
  onFreeLookChange,
  onMapState,
  onClose,
  onOpenPoster,
}: {
  open: boolean;
  filteredRoutes: AtlasRouteFeature[];
  allRoutes: AtlasRouteFeature[];
  achievements: Achievement[];
  placeClusters: PlaceCluster[];
  wellness: DailyWellness[];
  filterActive: boolean;
  filterLabel: string;
  freeLook: boolean;
  onFreeLookChange: (value: boolean) => void;
  onMapState: (state: PremiereMapState | null) => void;
  onClose: () => void;
  onOpenPoster: () => void;
}) {
  const [status, setStatus] = useState<PremiereStatus>("setup");
  const [scope, setScope] = useState<PremiereScope>(() => filterActive ? "filter" : "all");
  const [length, setLength] = useState<PremiereLength>("memory-cut");
  const [cameraMode, setCameraMode] = useState<PremiereCameraMode>("direction");
  const [showActivityCard, setShowActivityCard] = useState(true);
  const [showRecords, setShowRecords] = useState(true);
  const [showSeason, setShowSeason] = useState(true);
  const [showRecovery, setShowRecovery] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [customSpeed, setCustomSpeed] = useState(false);
  const [cameraTuning, setCameraTuning] = useState<PremiereCameraTuning>(() => ({ ...DEFAULT_PREMIERE_CAMERA_TUNING }));
  const [playheadMs, setPlayheadMs] = useState(0);
  const playheadRef = useRef(0);
  const previousTimestampRef = useRef(0);
  const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const routes = scope === "filter" && filterActive ? filteredRoutes : allRoutes;
  const settings = useMemo<PremiereSettings>(() => ({ length, cameraMode, showActivityCard, showRecords, showSeason, showRecovery }), [cameraMode, length, showActivityCard, showRecords, showRecovery, showSeason]);
  const story = useMemo(() => buildPremiereStory(routes, achievements, placeClusters, wellness, settings), [routes, achievements, placeClusters, wellness, settings]);
  const frame = useMemo(() => story ? premiereFrameAt(story, playheadMs) : null, [playheadMs, story]);
  const routeById = useMemo(() => new Map(allRoutes.map((route) => [route.id, route])), [allRoutes]);
  const activeRoute = frame?.routeId ? routeById.get(frame.routeId) : undefined;
  const activeAchievement = frame?.rideMeta?.achievementId ? achievements.find((item) => item.id === frame.rideMeta?.achievementId) : undefined;

  useEffect(() => {
    if (!open || status === "setup" || !story || !frame) {
      onMapState(null);
      return;
    }
    onMapState({ active: true, orderedRouteIds: story.orderedRouteIds, frame, cameraMode, playbackSpeed: speed, cameraTuning, freeLook, showRecords, showSeason, showRecovery, reducedMotion });
  }, [cameraMode, cameraTuning, frame, freeLook, onMapState, open, reducedMotion, showRecords, showRecovery, showSeason, speed, status, story]);

  useEffect(() => {
    if (!open || status !== "playing" || !story) return;
    let animationFrame = 0;
    previousTimestampRef.current = 0;
    const tick = (timestamp: number) => {
      if (!previousTimestampRef.current) previousTimestampRef.current = timestamp;
      const elapsed = Math.min(100, timestamp - previousTimestampRef.current) * speed;
      previousTimestampRef.current = timestamp;
      const next = Math.min(story.totalDurationMs, playheadRef.current + elapsed);
      playheadRef.current = next;
      setPlayheadMs(next);
      if (next >= story.totalDurationMs) {
        setStatus("complete");
        return;
      }
      animationFrame = window.requestAnimationFrame(tick);
    };
    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [open, speed, status, story]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.code === "Space" && status !== "setup") {
        event.preventDefault();
        setStatus((current) => current === "playing" ? "paused" : current === "complete" ? "complete" : "playing");
      }
      if (event.code === "ArrowRight" && story && frame) {
        event.preventDefault();
        const next = premiereSceneStart(story, frame.sceneIndex + 1);
        playheadRef.current = next;
        setPlayheadMs(next);
        setStatus("paused");
      }
      if (event.code === "ArrowLeft" && story && frame) {
        event.preventDefault();
        const previous = premiereSceneStart(story, frame.sceneIndex - 1);
        playheadRef.current = previous;
        setPlayheadMs(previous);
        setStatus("paused");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [frame, open, status, story]);

  const seek = useCallback((value: number) => {
    playheadRef.current = value;
    setPlayheadMs(value);
  }, []);

  const updateTuning = useCallback(<Key extends keyof PremiereCameraTuning>(key: Key, value: PremiereCameraTuning[Key]) => {
    setCameraTuning((current) => normalizePremiereCameraTuning({ ...current, [key]: value }));
  }, []);

  const cameraLab = <div className="premiere-tuning-grid">
    <div className="premiere-camera-mode-switch">{(["position", "direction", "overview"] as PremiereCameraMode[]).map((item) => <button key={item} type="button" className={cameraMode === item ? "active" : ""} aria-pressed={cameraMode === item} onClick={() => setCameraMode(item)}>{item === "position" ? "위치만" : item === "direction" ? "방향까지" : "전체 지도"}</button>)}</div>
    <label className="premiere-fit-activity" aria-disabled={cameraMode === "overview"}><input type="checkbox" checked={cameraMode === "overview" || cameraTuning.fitActivity} disabled={cameraMode === "overview"} onChange={(event) => updateTuning("fitActivity", event.target.checked)} />Activity 구간을 화면에 가득 맞춤</label>
    <TuningControl label="기본 배율" value={cameraTuning.followZoom} min={cameraTuning.minZoom} max={cameraTuning.maxZoom} step={0.1} onChange={(value) => updateTuning("followZoom", value)} />
    <TuningControl label="최소 배율" value={cameraTuning.minZoom} min={1.5} max={17} step={0.5} onChange={(value) => updateTuning("minZoom", value)} />
    <TuningControl label="최대 배율" value={cameraTuning.maxZoom} min={cameraTuning.minZoom} max={18} step={0.5} onChange={(value) => updateTuning("maxZoom", value)} />
    <TuningControl label="방향 반영" value={Math.round(cameraTuning.rotationStrength * 100)} min={0} max={100} step={5} suffix="%" disabled={cameraMode !== "direction"} onChange={(value) => updateTuning("rotationStrength", value / 100)} />
    <TuningControl label="회전 완충" value={cameraTuning.rotationSmoothingMs / 1_000} min={0.1} max={5} step={0.1} suffix="s" disabled={cameraMode !== "direction"} onChange={(value) => updateTuning("rotationSmoothingMs", value * 1_000)} />
    <TuningControl label="최대 회전속도" value={cameraTuning.rotationMaxDegreesPerSecond} min={5} max={360} step={5} suffix="°/s" disabled={cameraMode !== "direction"} onChange={(value) => updateTuning("rotationMaxDegreesPerSecond", value)} />
    <TuningControl label="배속 회전 보정" value={Math.round(cameraTuning.speedCompensation * 100)} min={0} max={200} step={5} suffix="%" disabled={cameraMode !== "direction"} onChange={(value) => updateTuning("speedCompensation", value / 100)} />
  </div>;

  const start = () => {
    if (!story) return;
    playheadRef.current = 0;
    setPlayheadMs(0);
    onFreeLookChange(false);
    setStatus("playing");
  };

  const exit = () => {
    setStatus("setup");
    seek(0);
    onFreeLookChange(false);
    onMapState(null);
    onClose();
  };

  const jumpScene = (direction: -1 | 1) => {
    if (!story || !frame) return;
    const next = premiereSceneStart(story, frame.sceneIndex + direction);
    seek(next);
    setStatus("paused");
  };

  if (!open) return null;

  if (status === "setup") return <section className="premiere-setup" role="dialog" aria-modal="true" aria-labelledby="premiere-title">
    <button className="premiere-close" type="button" onClick={exit} aria-label="Atlas Premiere 닫기">×</button>
    <p className="eyebrow">ATLAS PREMIERE · AURORA TRAVELER</p>
    <h2 id="premiere-title">과거의 나를 따라<br /><em>기억 여행을 시작합니다.</em></h2>
    <p className="premiere-intro">활동 경로는 실제 GPS 위에서 재생하고, 기록 사이 이동은 실제 경로가 아닌 Memory Jump로 구분합니다.</p>
    <div className="premiere-setup-grid">
      <fieldset><legend>범위</legend><button type="button" disabled={!filterActive} aria-pressed={scope === "filter"} className={scope === "filter" ? "active" : ""} onClick={() => setScope("filter")}>현재 Atlas 필터<small>{filterActive ? filterLabel : "현재 전체 기록"}</small></button><button type="button" aria-pressed={scope === "all"} className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>전체 Atlas<small>{allRoutes.length.toLocaleString("ko-KR")}개 GPS 활동</small></button></fieldset>
      <fieldset><legend>길이</legend>{(["memory-cut", "three-minute", "full-chronicle"] as PremiereLength[]).map((item) => <button key={item} type="button" aria-pressed={length === item} className={length === item ? "active" : ""} onClick={() => setLength(item)}>{item === "memory-cut" ? "60초 Memory Cut" : item === "three-minute" ? "3분 Chronicle" : "모든 활동 Follow"}</button>)}</fieldset>
      <fieldset><legend>카메라</legend>{(["position", "direction", "overview"] as PremiereCameraMode[]).map((item) => <button key={item} type="button" aria-pressed={cameraMode === item} className={cameraMode === item ? "active" : ""} onClick={() => setCameraMode(item)}>{item === "position" ? "위치만 Follow" : item === "direction" ? "방향까지 Follow" : "전체 지도"}<small>{item === "position" ? "북쪽을 고정하고 여행자만 추적" : item === "direction" ? "진행 방향을 부드럽게 추적" : "전체 활동을 한눈에 표시"}</small></button>)}</fieldset>
      <fieldset className="premiere-speed-setup"><legend>배속</legend><SpeedControl speed={speed} custom={customSpeed} onSpeedChange={setSpeed} onCustomChange={setCustomSpeed} /><small>0.1×부터 16×까지 직접 입력할 수 있습니다.</small></fieldset>
      <fieldset className="premiere-toggles"><legend>기억 레이어</legend><label><input type="checkbox" checked={showActivityCard} onChange={(event) => setShowActivityCard(event.target.checked)} />활동 카드</label><label><input type="checkbox" checked={showRecords} onChange={(event) => setShowRecords(event.target.checked)} />Records</label><label><input type="checkbox" checked={showSeason} onChange={(event) => setShowSeason(event.target.checked)} />Season</label><label><input type="checkbox" checked={showRecovery} onChange={(event) => setShowRecovery(event.target.checked)} />Recovery Aura</label></fieldset>
    </div>
    <details className="premiere-camera-lab"><summary>CAMERA LAB <span>배율·회전 감각 세부 조정</span></summary>{cameraLab}</details>
    <div className="premiere-ready"><span>{routes.length.toLocaleString("ko-KR")}개 GPS 활동</span><span>{story ? durationLabel(story.totalDurationMs) : "재생 불가"}</span><span>{story?.highlightRouteIds.length ?? 0}개 Follow 장면</span></div>
    <button className="premiere-start" type="button" disabled={!story} onClick={start}>▶ 기억 여행 시작</button>
    {!story && <p className="premiere-unavailable">현재 범위에는 재생할 GPS 경로가 없습니다.</p>}
  </section>;

  const totalDistance = routes.reduce((sum, route) => sum + (route.activity.distance.value ?? 0), 0);
  const totalHours = routes.reduce((sum, route) => sum + (route.activity.movingTime.value ?? 0), 0) / 3600;
  const sceneLabel = frame?.kind === "jump" ? frame.jumpKind === "long-gap" ? "TIME GAP" : "MEMORY JUMP" : frame?.kind === "montage" ? "MEMORY MONTAGE" : frame?.kind === "finale" ? "ATLAS COMPLETE" : frame?.kind === "prelude" ? "FIRST LIGHT" : "FOLLOWING A MEMORY";
  const finaleVisible = status === "complete" || frame?.kind === "finale";

  return <section className={`premiere-hud status-${finaleVisible ? "complete" : status}`} aria-label="Atlas Premiere 재생기">
    <header><span>{sceneLabel}</span><b>{activeRoute?.activity.localDate ?? (frame?.kind === "finale" ? story?.endDate : story?.startDate)}</b><button type="button" onClick={exit} aria-label="Premiere 종료">×</button></header>
    {showActivityCard && activeRoute && <article className="premiere-activity-card">
      <p>{frame?.rideMeta?.timestampMode === "recorded" ? "RECORDED TIME" : "VISUALIZED PROGRESS"}</p>
      <h2>{activeRoute.activity.name}</h2>
      <div>{[activeRoute.activity.type, metric(activeRoute.activity.distance.value, " km", 1), metric(activeRoute.activity.movingTime.value === null ? null : activeRoute.activity.movingTime.value / 3600, " h", 1), metric(activeRoute.activity.elevationGain?.value, " m")].filter(Boolean).map((item) => <span key={item}>{item}</span>)}</div>
      {showSeason && frame?.rideMeta && <small>{frame.rideMeta.season.toUpperCase()} SEASON</small>}
      {showRecovery && frame?.rideMeta?.recoveryScore != null && <small>RECOVERY AURA {frame.rideMeta.recoveryScore} · {frame.rideMeta.recoverySignals} SIGNALS</small>}
      {showRecords && activeAchievement && <strong>{activeAchievement.evidence === "source-confirmed" ? "◆ SOURCE RECORD" : "★ ATLAS RECORD"} · {activeAchievement.title}</strong>}
      {frame?.rideMeta?.firstVisit && <strong>NEW TERRITORY · 첫 지역 기록</strong>}
      {frame?.rideMeta?.echoRouteIds.length ? <em>ECHO RIDERS · 이 지역의 과거 활동 {frame.rideMeta.echoRouteIds.length}개</em> : null}
    </article>}
    {frame?.kind === "jump" && <div className="premiere-jump-copy"><b>{frame.jumpKind === "long-gap" ? `${frame.gapDays?.toLocaleString("ko-KR")} DAYS LATER` : "MEMORY JUMP"}</b><span>실제 이동 경로가 아닌 활동 사이의 기억 전환입니다.</span></div>}
    <details className="premiere-live-tuning"><summary>CAMERA LAB</summary>{cameraLab}</details>
    {finaleVisible && <div className="premiere-finale"><p className="eyebrow">YOUR EXPERIENCE ATLAS</p><h2>{routes.length.toLocaleString("ko-KR")} ACTIVITIES</h2><p>{story?.startDate} — {story?.endDate} · {totalDistance.toLocaleString("ko-KR", { maximumFractionDigits: 0 })} KM · {totalHours.toLocaleString("ko-KR", { maximumFractionDigits: 0 })} H</p><strong>THIS IS WHERE YOU HAVE BEEN.</strong><div><button type="button" onClick={start}>다시 여행하기</button><button type="button" onClick={() => { exit(); onOpenPoster(); }}>PNG로 남기기</button><button type="button" onClick={exit}>Atlas로 돌아가기</button></div></div>}
    <footer className="premiere-controls">
      <button type="button" onClick={() => jumpScene(-1)} aria-label="이전 Premiere 장면">←</button>
      <button type="button" className="premiere-play" onClick={() => setStatus((current) => current === "playing" ? "paused" : current === "complete" ? "complete" : "playing")} aria-label={status === "playing" ? "Premiere 일시정지" : "Premiere 재생"}>{status === "playing" ? "Ⅱ" : "▶"}</button>
      <button type="button" onClick={() => jumpScene(1)} aria-label="다음 Premiere 장면">→</button>
      <input aria-label="Premiere 재생 위치" type="range" min={0} max={story?.totalDurationMs ?? 0} step={100} value={playheadMs} onChange={(event) => { const value = Number(event.target.value); seek(value); setStatus(story && value >= story.totalDurationMs ? "complete" : "paused"); }} />
      <span>{durationLabel(playheadMs)} / {durationLabel(story?.totalDurationMs ?? 0)}</span>
      <SpeedControl speed={speed} custom={customSpeed} compact onSpeedChange={setSpeed} onCustomChange={setCustomSpeed} />
      {freeLook ? <button type="button" className="follow-return" onClick={() => onFreeLookChange(false)}>여행자 다시 따라가기</button> : <span className="follow-state">{cameraMode === "overview" ? "OVERVIEW" : cameraMode === "position" ? "POSITION" : "DIRECTION"}{cameraTuning.fitActivity ? " · FRAME" : ""}</span>}
    </footer>
  </section>;
}
