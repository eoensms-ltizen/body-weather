"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildPremiereStory, premiereFrameAt, premiereSceneStart, type PremiereCameraMode, type PremiereLength, type PremiereMapState, type PremiereSettings } from "@/lib/premiere";
import type { Achievement, AtlasRouteFeature, DailyWellness, PlaceCluster } from "@/lib/types";

type PremiereStatus = "setup" | "playing" | "paused" | "complete";
type PremiereScope = "filter" | "all";

function durationLabel(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}분 ${String(seconds).padStart(2, "0")}초` : `${seconds}초`;
}

function metric(value: number | null | undefined, unit: string, digits = 0): string | null {
  return value === null || value === undefined ? null : `${value.toLocaleString("ko-KR", { maximumFractionDigits: digits })}${unit}`;
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
  const [cameraMode, setCameraMode] = useState<PremiereCameraMode>("cinematic");
  const [showActivityCard, setShowActivityCard] = useState(true);
  const [showRecords, setShowRecords] = useState(true);
  const [showSeason, setShowSeason] = useState(true);
  const [showRecovery, setShowRecovery] = useState(true);
  const [speed, setSpeed] = useState(1);
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
    onMapState({ active: true, orderedRouteIds: story.orderedRouteIds, frame, cameraMode, freeLook, showRecords, showSeason, showRecovery, reducedMotion });
  }, [cameraMode, frame, freeLook, onMapState, open, reducedMotion, showRecords, showRecovery, showSeason, status, story]);

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
      <fieldset><legend>카메라</legend>{(["follow", "cinematic", "overview"] as PremiereCameraMode[]).map((item) => <button key={item} type="button" aria-pressed={cameraMode === item} className={cameraMode === item ? "active" : ""} onClick={() => setCameraMode(item)}>{item === "follow" ? "여행자 Follow" : item === "cinematic" ? "Cinematic" : "전체 지도"}</button>)}</fieldset>
      <fieldset className="premiere-toggles"><legend>기억 레이어</legend><label><input type="checkbox" checked={showActivityCard} onChange={(event) => setShowActivityCard(event.target.checked)} />활동 카드</label><label><input type="checkbox" checked={showRecords} onChange={(event) => setShowRecords(event.target.checked)} />Records</label><label><input type="checkbox" checked={showSeason} onChange={(event) => setShowSeason(event.target.checked)} />Season</label><label><input type="checkbox" checked={showRecovery} onChange={(event) => setShowRecovery(event.target.checked)} />Recovery Aura</label></fieldset>
    </div>
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
    {finaleVisible && <div className="premiere-finale"><p className="eyebrow">YOUR EXPERIENCE ATLAS</p><h2>{routes.length.toLocaleString("ko-KR")} ACTIVITIES</h2><p>{story?.startDate} — {story?.endDate} · {totalDistance.toLocaleString("ko-KR", { maximumFractionDigits: 0 })} KM · {totalHours.toLocaleString("ko-KR", { maximumFractionDigits: 0 })} H</p><strong>THIS IS WHERE YOU HAVE BEEN.</strong><div><button type="button" onClick={start}>다시 여행하기</button><button type="button" onClick={() => { exit(); onOpenPoster(); }}>PNG로 남기기</button><button type="button" onClick={exit}>Atlas로 돌아가기</button></div></div>}
    <footer className="premiere-controls">
      <button type="button" onClick={() => jumpScene(-1)} aria-label="이전 Premiere 장면">←</button>
      <button type="button" className="premiere-play" onClick={() => setStatus((current) => current === "playing" ? "paused" : current === "complete" ? "complete" : "playing")} aria-label={status === "playing" ? "Premiere 일시정지" : "Premiere 재생"}>{status === "playing" ? "Ⅱ" : "▶"}</button>
      <button type="button" onClick={() => jumpScene(1)} aria-label="다음 Premiere 장면">→</button>
      <input aria-label="Premiere 재생 위치" type="range" min={0} max={story?.totalDurationMs ?? 0} step={100} value={playheadMs} onChange={(event) => { const value = Number(event.target.value); seek(value); setStatus(story && value >= story.totalDurationMs ? "complete" : "paused"); }} />
      <span>{durationLabel(playheadMs)} / {durationLabel(story?.totalDurationMs ?? 0)}</span>
      <select aria-label="Premiere 재생 속도" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select>
      {freeLook ? <button type="button" className="follow-return" onClick={() => onFreeLookChange(false)}>여행자 다시 따라가기</button> : <span className="follow-state">{cameraMode === "overview" ? "OVERVIEW" : "FOLLOWING"}</span>}
    </footer>
  </section>;
}
