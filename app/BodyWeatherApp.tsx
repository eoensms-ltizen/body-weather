"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { AtlasColorMode } from "./AtlasMap";
import { buildAtlasModel, mergeBounds, subsetAtlasModel } from "@/lib/atlas";
import { buildForecast } from "@/lib/forecast";
import { buildMemories } from "@/lib/memories";
import { importHealthArchives } from "@/lib/importer";
import { posterDimensions, renderPoster, type PosterColorMode, type PosterRatio, type PosterTheme } from "@/lib/poster";
import { buildVerificationSummary } from "@/lib/verification-fixture";
import type { Activity, AtlasModel, AtlasRouteFeature, Capability, ForecastSnapshot, ImportSummary, MemoryCard, MetricValue, TomorrowScenario } from "@/lib/types";

type View = "atlas" | "forecast" | "memories" | "data";

const AtlasMap = lazy(() => import("./AtlasMap"));

const COLOR_MODES: Array<{ key: AtlasColorMode; label: string; hint: string; capability?: string }> = [
  { key: "memory", label: "Memory Glow", hint: "겹쳐진 경험" },
  { key: "sport", label: "Sport", hint: "종목별 색상" },
  { key: "season", label: "Season", hint: "계절의 흐름" },
  { key: "effort", label: "Effort", hint: "훈련 부하", capability: "effort" },
  { key: "heart", label: "Heart", hint: "평균 심박", capability: "heart" },
  { key: "power", label: "Power", hint: "평균 파워", capability: "power" },
  { key: "achievement", label: "Records", hint: "성과와 기록" },
];

const SCENARIOS: Array<{ key: TomorrowScenario; label: string; copy: string }> = [
  { key: "rest", label: "휴식", copy: "움직임을 줄이는 경우" },
  { key: "easy", label: "가볍게", copy: "낮은 강도로 움직이는 경우" },
  { key: "moderate", label: "보통", copy: "평소 정도로 운동하는 경우" },
  { key: "hard", label: "고강도", copy: "강한 자극을 주는 경우" },
];

function metricText(metric: MetricValue | undefined, digits = 0): string {
  if (!metric || metric.value === null) return "측정 없음";
  return `${metric.value.toLocaleString("ko-KR", { maximumFractionDigits: digits })} ${metric.unit}`.trim();
}

function formatDuration(metric: MetricValue | undefined): string {
  if (!metric || metric.value === null) return "측정 없음";
  const hours = Math.floor(metric.value / 3600);
  const minutes = Math.round((metric.value % 3600) / 60);
  return hours ? `${hours}시간 ${minutes}분` : `${minutes}분`;
}

function formatDate(date: string): string {
  if (!date) return "날짜 없음";
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric" }).format(new Date(`${date}T12:00:00`));
}

function confidenceLabel(value: ForecastSnapshot["confidence"]): string {
  return value === "high" ? "높음" : value === "medium" ? "보통" : "낮음";
}

function ImportScreen({ onImported }: { onImported: (summary: ImportSummary) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [fullHistory, setFullHistory] = useState(true);
  const [startDate, setStartDate] = useState("2026-04-01");
  const [endDate, setEndDate] = useState("2026-07-12");
  const [stage, setStage] = useState("ZIP을 선택하면 모든 처리는 이 브라우저 안에서 시작됩니다.");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const importFiles = async () => {
    if (!files.length) return;
    setBusy(true);
    setError("");
    try {
      const summary = await importHealthArchives(files, {
        startDate: fullHistory ? undefined : startDate,
        endDate: fullHistory ? undefined : endDate,
        onProgress(nextStage, nextProgress) { setStage(nextStage); setProgress(nextProgress); },
      });
      if (!summary.activities.length && !summary.wellness.length) throw new Error("지원 가능한 운동 또는 웰니스 데이터가 없습니다.");
      onImported(summary);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "가져오기를 완료하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return <main className="import-shell">
    <section className="import-hero">
      <div className="brand-mark">BW</div>
      <p className="eyebrow">PRIVATE EXPERIENCE ATLAS</p>
      <h1>당신의 몸에도<br /><em>날씨가 흐릅니다.</em></h1>
      <p className="hero-copy">지나온 모든 길과 회복의 리듬을 겹쳐, 나만의 움직임이 만든 지도를 펼쳐보세요.</p>
      <div className="privacy-note"><span>LOCAL FIRST</span> ZIP과 건강·경로 원본은 서버에 저장하거나 전송하지 않습니다.</div>
    </section>
    <section className="import-card" aria-labelledby="import-title">
      <div><p className="step-label">01 / OPEN YOUR ATLAS</p><h2 id="import-title">내보내기 ZIP 가져오기</h2><p>Strava, Garmin 중 하나만 있어도 시작합니다. 사진과 영상은 제외하고 존재하는 필드만 사용합니다.</p></div>
      <label className="drop-zone" htmlFor="archive-files">
        <input id="archive-files" data-testid="archive-input" type="file" accept=".zip,application/zip" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
        <span className="drop-icon">＋</span><strong>ZIP 파일 선택</strong><small>여러 ZIP을 한 번에 넣을 수 있습니다.</small>
      </label>
      {files.length > 0 && <ul className="file-list">{files.map((file) => <li key={`${file.name}-${file.size}`}><span>{file.name}</span><b>{(file.size / 1024 / 1024).toFixed(1)} MB</b></li>)}</ul>}
      <div className="period-choice">
        <button type="button" aria-pressed={fullHistory} className={fullHistory ? "active" : ""} onClick={() => setFullHistory(true)}><b>전체 기간</b><small>누적 경험 지도를 만듭니다</small></button>
        <button type="button" aria-pressed={!fullHistory} className={!fullHistory ? "active" : ""} onClick={() => setFullHistory(false)}><b>기간 지정</b><small>일부 기간만 분석합니다</small></button>
      </div>
      {!fullHistory && <div className="date-fields"><label>시작일<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>종료일<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label></div>}
      {busy && <div className="progress-panel" role="status"><div><span style={{ width: `${Math.max(4, progress * 100)}%` }} /></div><p>{stage}</p></div>}
      {error && <p className="error-message" role="alert">{error}</p>}
      <button className="primary-action" data-testid="import-action" type="button" disabled={!files.length || busy} onClick={importFiles}>{busy ? "경험을 지도에 펼치는 중…" : "Experience Atlas 만들기"}</button>
      <p className="security-copy">안전하지 않은 압축 경로와 비정상 크기를 차단하며, 한 파일의 오류가 다른 정상 데이터를 막지 않습니다.</p>
    </section>
  </main>;
}

function CapabilityStrip({ capabilities }: { capabilities: Capability[] }) {
  return <div className="capability-strip" aria-label="활성 데이터 기능">{capabilities.map((capability) => <span key={capability.key} className={capability.state} title={capability.reason}><i />{capability.label}<b>{Math.round(capability.coverage * 100)}%</b></span>)}</div>;
}

function ActivityDrawer({ route, onClose }: { route: AtlasRouteFeature; onClose: () => void }) {
  const activity = route.activity;
  return <aside className="detail-drawer" aria-label={`${activity.name} 활동 상세`}>
    <button className="drawer-close" type="button" onClick={onClose} aria-label="활동 상세 닫기">×</button>
    <p className="eyebrow">ACTIVITY TRACE</p>
    <h2>{activity.name}</h2>
    <p className="drawer-meta">{formatDate(activity.localDate)} · {activity.type} · {route.masked ? "민감 위치 마스킹" : "원본 경로"}</p>
    <div className="drawer-metrics">
      <div><span>거리</span><strong>{metricText(activity.distance, 1)}</strong></div>
      <div><span>이동 시간</span><strong>{formatDuration(activity.movingTime)}</strong></div>
      <div><span>평균 심박</span><strong>{metricText(activity.averageHeartRate)}</strong></div>
      <div><span>평균 파워</span><strong>{metricText(activity.averagePower)}</strong></div>
      <div><span>운동 부하</span><strong>{metricText(activity.trainingLoad.value !== null ? activity.trainingLoad : activity.relativeEffort)}</strong></div>
      <div><span>원본 경로점</span><strong>{route.rawPointCount.toLocaleString("ko-KR")}</strong></div>
    </div>
    <div className="source-block"><span>근거</span><code>{activity.source} · {activity.sourceFile}</code><small>측정되지 않은 값은 0이 아니라 ‘측정 없음’으로 유지됩니다.</small></div>
  </aside>;
}

function AtlasView({
  summary,
  colorMode,
  setColorMode,
  filteredActivities,
  rangeStart,
  rangeEnd,
  setRangeStart,
  setRangeEnd,
  typeFilter,
  setTypeFilter,
  reveal,
  setReveal,
  selectedRoute,
  setSelectedRoute,
  focusCoordinate,
  onOpenForecast,
  fullAtlas,
}: {
  summary: ImportSummary;
  colorMode: AtlasColorMode;
  setColorMode: (mode: AtlasColorMode) => void;
  filteredActivities: Activity[];
  rangeStart: string;
  rangeEnd: string;
  setRangeStart: (date: string) => void;
  setRangeEnd: (date: string) => void;
  typeFilter: string;
  setTypeFilter: (type: string) => void;
  reveal: number;
  setReveal: (value: number) => void;
  selectedRoute: AtlasRouteFeature | null;
  setSelectedRoute: (route: AtlasRouteFeature | null) => void;
  focusCoordinate: [number, number] | null;
  onOpenForecast: () => void;
  fullAtlas: AtlasModel;
}) {
  const filteredAtlas = useMemo(() => filteredActivities.length === summary.activities.length ? fullAtlas : subsetAtlasModel(fullAtlas, filteredActivities), [filteredActivities, summary.activities.length, fullAtlas]);
  const shownRoutes = useMemo(() => filteredAtlas.routes.slice(0, Math.max(1, Math.ceil(filteredAtlas.routes.length * reveal))), [filteredAtlas.routes, reveal]);
  const shownBounds = useMemo(() => reveal < 1 ? mergeBounds(shownRoutes.map((route) => route.bounds)) : filteredAtlas.bounds, [shownRoutes, filteredAtlas.bounds, reveal]);
  const activeCapabilities = new Map(summary.capabilityProfile.capabilities.map((item) => [item.key, item]));
  const types = [...new Set(summary.activities.map((activity) => activity.type))].sort();
  const latestForecast = buildForecast(summary);
  const threeMonthsBefore = new Date(`${summary.endDate}T12:00:00`); threeMonthsBefore.setMonth(threeMonthsBefore.getMonth() - 3);
  const lastYear = summary.endDate.slice(0, 4);

  return <section className="atlas-view">
    {filteredAtlas.routes.length ? <Suspense fallback={<div className="route-empty"><span>ATLAS ENGINE</span><h2>지도를 깨우는 중</h2></div>}><AtlasMap routes={shownRoutes} bounds={shownBounds} achievements={filteredAtlas.achievements} placeClusters={filteredAtlas.placeClusters} colorMode={colorMode} selectedId={selectedRoute?.id} focusCoordinate={focusCoordinate} onSelect={setSelectedRoute} /></Suspense> : <div className="route-empty"><span>NO GPS TRACE</span><h2>경로 좌표 없이도<br />시간은 남아 있습니다.</h2><p>이 ZIP에는 지도에 그릴 좌표가 없습니다. 활동 날짜와 거리, 회복 기록으로 Forecast와 Memories를 구성했습니다.</p></div>}
    <div className="atlas-title"><p className="eyebrow">ALL-TIME EXPERIENCE MAP</p><h1>{summary.startDate.slice(0, 4)} — {summary.endDate.slice(0, 4)}</h1><p>{filteredActivities.length.toLocaleString("ko-KR")}개 활동 · {filteredAtlas.routeActivityCount.toLocaleString("ko-KR")}개 경로 · {filteredAtlas.placeClusters.length.toLocaleString("ko-KR")}개 지역 경험</p></div>
    <button type="button" className={`forecast-peek weather-${latestForecast.weatherState.replace(" ", "-")}`} onClick={onOpenForecast}>
      <span>{latestForecast.displayMode === "today" ? "TODAY" : "LATEST"} · {latestForecast.asOfDate}</span>
      <strong>{latestForecast.weatherState} <b>{latestForecast.score ?? "—"}</b></strong>
      <small>{latestForecast.recommendationBand} · 신뢰도 {confidenceLabel(latestForecast.confidence)} ↗</small>
    </button>
    <aside className="atlas-layers" aria-label="지도 색상 모드">
      <p>LAYERS</p>
      {COLOR_MODES.map((mode) => {
        const capability = mode.capability ? activeCapabilities.get(mode.capability) : undefined;
        const disabled = capability?.state === "unavailable";
        return <button key={mode.key} type="button" aria-pressed={colorMode === mode.key} disabled={disabled} className={colorMode === mode.key ? "active" : ""} onClick={() => setColorMode(mode.key)} title={disabled ? capability?.reason : mode.hint}><i className={`layer-dot ${mode.key}`} /><span>{mode.label}<small>{disabled ? "측정 없음" : mode.hint}</small></span></button>;
      })}
    </aside>
    <div className="atlas-filters">
      <div className="preset-row">
        <button type="button" aria-pressed={rangeStart === summary.startDate && rangeEnd === summary.endDate} onClick={() => { setRangeStart(summary.startDate); setRangeEnd(summary.endDate); }}>전체</button>
        <button type="button" aria-pressed={rangeStart === threeMonthsBefore.toISOString().slice(0, 10) && rangeEnd === summary.endDate} onClick={() => { setRangeStart(threeMonthsBefore.toISOString().slice(0, 10)); setRangeEnd(summary.endDate); }}>최근 3개월</button>
        <button type="button" aria-pressed={rangeStart === `${lastYear}-01-01` && rangeEnd === summary.endDate} onClick={() => { setRangeStart(`${lastYear}-01-01`); setRangeEnd(summary.endDate); }}>{lastYear}</button>
        <select aria-label="종목 필터" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">모든 종목</option>{types.map((type) => <option key={type} value={type}>{type}</option>)}</select>
      </div>
      <div className="range-row"><label>FROM<input type="date" value={rangeStart} min={summary.startDate} max={rangeEnd} onChange={(event) => setRangeStart(event.target.value)} /></label><span>—</span><label>TO<input type="date" value={rangeEnd} min={rangeStart} max={summary.endDate} onChange={(event) => setRangeEnd(event.target.value)} /></label></div>
    </div>
    {reveal < 1 && <div className="reveal-panel" role="status"><div><span style={{ width: `${Math.round(reveal * 100)}%` }} /></div><p>당신의 경로가 시간 위로 떠오르는 중 · {Math.round(reveal * 100)}%</p><button type="button" onClick={() => setReveal(1)}>건너뛰기</button></div>}
    <div className="map-legend"><span><i className="source" />원본 성과</span><span><i className="derived" />Atlas 개인기록</span><b>{filteredAtlas.privacyZones.length ? `민감 위치 ${filteredAtlas.privacyZones.length}곳 마스킹` : "민감 위치 후보 없음"}</b></div>
  </section>;
}

function ForecastView({ summary }: { summary: ImportSummary }) {
  const [scenario, setScenario] = useState<TomorrowScenario>("easy");
  const forecast = useMemo(() => buildForecast(summary, scenario), [summary, scenario]);
  const scenarioCopy = SCENARIOS.find((item) => item.key === scenario)?.copy;
  return <section className="forecast-view content-page">
    <header className="content-header"><p className="eyebrow">BODY WEATHER FORECAST</p><h1>{forecast.displayMode === "today" ? "오늘의 몸은" : "마지막 관측의 몸은"}<br /><em>{forecast.weatherState}입니다.</em></h1><p>데이터 기준 {forecast.asOfDate} · {forecast.freshnessDays ? `${forecast.freshnessDays}일 전 관측` : "최신 관측"} · Tier {forecast.tier}</p></header>
    <div className={`forecast-hero state-${forecast.weatherState.replace(" ", "-")}`}>
      <div className="weather-orb"><span>{forecast.weatherState}</span><strong>{forecast.score ?? "—"}</strong><small>100</small></div>
      <div className="forecast-verdict"><span>{forecast.displayMode === "today" ? "TODAY" : "RECENT OBSERVATION"}</span><h2>{forecast.recommendationBand}</h2><p>{forecast.reasons[0] ?? "현재 점수를 만들 수 있는 회복 신호가 충분하지 않습니다."}</p><div><b>신뢰도 {confidenceLabel(forecast.confidence)}</b><i />{forecast.factors.length}개 신호 사용</div></div>
      <div className="tomorrow-card"><span>{forecast.nextLabel.toUpperCase()}</span><strong>{forecast.scoreRange ? `${forecast.scoreRange[0]}–${forecast.scoreRange[1]}` : "관측 부족"}</strong><p>{scenarioCopy}</p><small>예상 범위 · 확정적 예측이 아닙니다</small></div>
    </div>
    <section className="scenario-section"><div><p className="eyebrow">WHAT IF</p><h2>오늘의 계획을 바꾸면?</h2><p>계획 강도에 따라 다음 날 예상 범위와 불확실성이 바뀝니다.</p></div><div className="scenario-buttons">{SCENARIOS.map((item) => <button key={item.key} type="button" aria-pressed={scenario === item.key} className={scenario === item.key ? "active" : ""} onClick={() => setScenario(item.key)}><b>{item.label}</b><small>{item.copy}</small></button>)}</div></section>
    <section className="factor-section"><header><p className="eyebrow">WHY THIS WEATHER</p><h2>점수를 만든 관측 신호</h2></header>{forecast.factors.length ? <div className="factor-grid">{forecast.factors.map((item) => <article key={item.key}><div><span>{item.label}</span><strong>{Math.round(item.normalizedScore)}</strong></div><div className="factor-bar"><i style={{ width: `${item.normalizedScore}%` }} /></div><p>{item.explanation}</p><small>{item.source} · 기준선 {item.baselineDays}일 · 가중치 {Math.round(item.weight * 100)}%</small></article>)}</div> : <p className="empty-state">Forecast를 계산할 측정값이 없습니다. 활동 날짜만으로 점수를 만들지 않았습니다.</p>}</section>
    <aside className="forecast-disclaimer">개인 기록에서 관찰된 회복 신호를 요약한 것으로 의료 판단이나 확정적인 훈련 처방이 아닙니다.</aside>
  </section>;
}

function PosterStudio({ summary, routes, achievementIds }: { summary: ImportSummary; routes: AtlasRouteFeature[]; achievementIds: string[] }) {
  const [title, setTitle] = useState("MY EXPERIENCE ATLAS");
  const [theme, setTheme] = useState<PosterTheme>("night");
  const [ratio, setRatio] = useState<PosterRatio>("16:9");
  const [colorMode, setColorMode] = useState<PosterColorMode>("memory");
  const [previewUrl, setPreviewUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastExport, setLastExport] = useState("");
  const totalDistance = summary.activities.reduce((sum, activity) => sum + (activity.distance.value ?? 0), 0);
  const baseConfig = useMemo(() => ({ title, subtitle: "Every road becomes a memory.", theme, ratio, colorMode, showStats: true, privacyMasked: true, activityCount: summary.activities.length, distanceLabel: `${totalDistance.toLocaleString("ko-KR", { maximumFractionDigits: 0 })} km`, periodLabel: `${summary.startDate} — ${summary.endDate}` }), [title, theme, ratio, colorMode, summary.activities.length, summary.startDate, summary.endDate, totalDistance]);

  useEffect(() => {
    let disposed = false;
    let url = "";
    const timer = window.setTimeout(async () => {
      try {
        const result = await renderPoster(routes, achievementIds, { ...baseConfig, preview: true });
        if (disposed) return;
        url = URL.createObjectURL(result.blob);
        setPreviewUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return url; });
      } catch { /* Preview remains as a branded CSS surface. */ }
    }, 180);
    return () => { disposed = true; window.clearTimeout(timer); if (url) URL.revokeObjectURL(url); };
  }, [routes, achievementIds, baseConfig]);

  const download = async () => {
    setBusy(true);
    try {
      const result = await renderPoster(routes, achievementIds, baseConfig);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `body-weather-atlas-${ratio.replace(":", "x")}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setLastExport(`${result.width.toLocaleString("ko-KR")} × ${result.height.toLocaleString("ko-KR")} · ${(result.blob.size / 1024 / 1024).toFixed(1)} MB · 민감 위치 마스킹`);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally { setBusy(false); }
  };
  const [width, height] = posterDimensions(ratio);

  return <section className="poster-studio">
    <div className="poster-preview">{previewUrl ? <div className="poster-image" role="img" aria-label="개인정보가 마스킹된 Experience Atlas 포스터 미리보기" style={{ backgroundImage: `url(${previewUrl})` }} /> : <div className="poster-placeholder">POSTER PREVIEW</div>}<span>PRIVATE COORDINATES MASKED</span></div>
    <div className="poster-controls"><p className="eyebrow">POSTER STUDIO</p><h2>경험을 한 장으로 남기기</h2><label>제목<input value={title} maxLength={36} onChange={(event) => setTitle(event.target.value)} /></label><div className="control-group"><span>테마</span><div>{(["night", "aurora", "paper"] as PosterTheme[]).map((item) => <button key={item} type="button" className={theme === item ? "active" : ""} onClick={() => setTheme(item)}>{item}</button>)}</div></div><div className="control-group"><span>비율</span><div>{(["16:9", "4:5", "9:16"] as PosterRatio[]).map((item) => <button key={item} type="button" className={ratio === item ? "active" : ""} onClick={() => setRatio(item)}>{item}</button>)}</div></div><div className="control-group"><span>경로 색상</span><select value={colorMode} onChange={(event) => setColorMode(event.target.value as PosterColorMode)}><option value="memory">Memory Glow</option><option value="sport">Sport</option><option value="season">Season</option><option value="achievement">Achievement</option></select></div><p className="poster-size">{width.toLocaleString("ko-KR")} × {height.toLocaleString("ko-KR")} PNG · GPS/EXIF 없음</p><button data-testid="poster-download" className="primary-action" type="button" disabled={busy || !routes.length} onClick={download}>{busy ? "고해상도 렌더링 중…" : "고해상도 PNG 저장"}</button>{lastExport && <p className="poster-export-status" role="status">완료 · {lastExport}</p>}</div>
  </section>;
}

function MemoriesView({ summary, atlas, onOpenMemory }: { summary: ImportSummary; atlas: AtlasModel; onOpenMemory: (memory: MemoryCard) => void }) {
  const collection = useMemo(() => buildMemories(summary, atlas), [summary, atlas]);
  return <section className="memories-view content-page">
    <header className="content-header"><p className="eyebrow">MEMORIES · ALL TIME</p><h1>길은 사라져도<br /><em>경험은 지도가 됩니다.</em></h1><p>{summary.startDate} — {summary.endDate} · {collection.years.length}개의 해</p></header>
    <div className="season-summary"><div><span>총 거리</span><strong>{collection.totalDistance === null ? "측정 없음" : `${collection.totalDistance.toLocaleString("ko-KR", { maximumFractionDigits: 0 })} km`}</strong></div><div><span>움직인 시간</span><strong>{collection.totalHours === null ? "측정 없음" : `${collection.totalHours.toLocaleString("ko-KR", { maximumFractionDigits: 0 })} h`}</strong></div><div><span>활동 일수</span><strong>{collection.activityDays.toLocaleString("ko-KR")} days</strong></div><div><span>경로 지역</span><strong>{atlas.placeClusters.length.toLocaleString("ko-KR")} places</strong></div></div>
    <div className="memory-grid">{collection.cards.map((memory, index) => <button key={memory.id} type="button" className={`memory-card kind-${memory.kind}`} onClick={() => onOpenMemory(memory)}><span>{memory.eyebrow}</span><b>{String(index + 1).padStart(2, "0")}</b><h2>{memory.title}</h2><p>{memory.description}</p><small>{memory.evidence} ↗</small></button>)}</div>
    <PosterStudio summary={summary} routes={atlas.routes} achievementIds={atlas.achievements.map((item) => item.activityId)} />
  </section>;
}

function DataView({ summary, atlas }: { summary: ImportSummary; atlas: AtlasModel }) {
  return <section className="data-view content-page">
    <header className="content-header"><p className="eyebrow">DATA & PRIVACY</p><h1>무엇을 알고,<br /><em>무엇을 모르는지.</em></h1><p>빈 필드와 센서 공백을 감추지 않고, 실제로 사용할 수 있는 경험만 구성합니다.</p></header>
    <CapabilityStrip capabilities={summary.capabilityProfile.capabilities} />
    <div className="privacy-grid"><article><span>LOCAL PROCESSING</span><strong>서버 전송 없음</strong><p>ZIP, 건강 원본, GPS 경로는 현재 브라우저에서만 해석합니다.</p></article><article><span>ROUTE PRIVACY</span><strong>{atlas.privacyZones.length}개 민감 후보</strong><p>반복된 출발·도착 주변 300m를 지도와 Poster에서 마스킹합니다.</p></article><article><span>MAP NETWORK</span><strong>베이스맵 타일만</strong><p>경로 원본은 보내지 않지만 보고 있는 지도 영역은 타일 공급자에게 전달될 수 있습니다.</p></article><article><span>MEDIA EXCLUDED</span><strong>{summary.mediaSkipped.toLocaleString("ko-KR")}개 제외</strong><p>사진과 영상은 압축 해제하거나 분석하지 않았습니다.</p></article></div>
    <div className="data-summary-grid"><div><span>활동</span><strong>{summary.activities.length}</strong></div><div><span>경로</span><strong>{atlas.routes.length}</strong></div><div><span>웰니스 일수</span><strong>{summary.wellness.length}</strong></div><div><span>진단</span><strong>{summary.issues.length}</strong></div></div>
    <div className="issue-list"><h2>가져오기 진단</h2>{summary.issues.length ? summary.issues.slice(0, 30).map((issue) => <div key={issue.id} className={issue.severity}><span>{issue.code}</span><p>{issue.message}</p><b>{issue.recoverable ? "복구됨" : "확인 필요"}</b></div>) : <p className="empty-state">해석 오류 없이 가져왔습니다.</p>}</div>
    <details className="advanced-insights"><summary>Advanced insights · 기존 상관관계 분석 안내</summary><p>고급 분석은 최소 5개의 측정된 날짜쌍이 있을 때만 생성됩니다. 상관관계는 원인이나 의료 판단을 의미하지 않습니다.</p></details>
  </section>;
}

export default function BodyWeatherApp() {
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [view, setView] = useState<View>("atlas");
  const [colorMode, setColorMode] = useState<AtlasColorMode>("memory");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [reveal, setReveal] = useState(1);
  const [selectedRoute, setSelectedRoute] = useState<AtlasRouteFeature | null>(null);
  const [focusCoordinate, setFocusCoordinate] = useState<[number, number] | null>(null);
  const [fullAtlas, setFullAtlas] = useState<AtlasModel>(() => buildAtlasModel([], true));

  const handleImported = useCallback((result: ImportSummary) => {
    setSummary(result);
    setRangeStart(result.startDate);
    setRangeEnd(result.endDate);
    setView("atlas");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReveal(reduced ? 1 : 0.03);
  }, []);

  useEffect(() => {
    if (window.location.hostname === "localhost" && new URLSearchParams(window.location.search).get("__fixture") === "full") {
      const timer = window.setTimeout(() => handleImported(buildVerificationSummary()), 0);
      return () => window.clearTimeout(timer);
    }
  }, [handleImported]);

  useEffect(() => {
    if (!summary || reveal >= 1) return;
    const timer = window.setInterval(() => setReveal((value) => Math.min(1, value + 0.045)), 90);
    return () => window.clearInterval(timer);
  }, [summary, reveal]);

  useEffect(() => {
    if (!summary) return;
    let disposed = false;
    let worker: Worker | null = null;
    const fallback = () => {
      if (!disposed) setFullAtlas(buildAtlasModel(summary.activities, true));
    };
    try {
      worker = new Worker(new URL("../lib/atlas.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<{ requestId: number; atlas?: AtlasModel; error?: string }>) => {
        if (disposed) return;
        if (event.data.atlas) setFullAtlas(event.data.atlas);
        else fallback();
        worker?.terminate();
        worker = null;
      };
      worker.onerror = () => { worker?.terminate(); worker = null; fallback(); };
      worker.postMessage({ requestId: 1, activities: summary.activities, maskPrivate: true });
    } catch {
      const timer = window.setTimeout(fallback, 0);
      return () => { disposed = true; window.clearTimeout(timer); };
    }
    return () => { disposed = true; worker?.terminate(); };
  }, [summary]);

  const filteredActivities = useMemo(() => summary?.activities.filter((activity) =>
    (!rangeStart || activity.localDate >= rangeStart) && (!rangeEnd || activity.localDate <= rangeEnd) &&
    (typeFilter === "all" || activity.type === typeFilter)) ?? [], [summary, rangeStart, rangeEnd, typeFilter]);
  const openMemory = (memory: MemoryCard) => {
    if (!summary) return;
    if (memory.date) {
      const year = memory.date.slice(0, 4);
      setRangeStart(`${year}-01-01` < summary.startDate ? summary.startDate : `${year}-01-01`);
      setRangeEnd(`${year}-12-31` > summary.endDate ? summary.endDate : `${year}-12-31`);
    }
    setFocusCoordinate(memory.coordinate ?? null);
    setView("atlas");
  };

  if (!summary) return <ImportScreen onImported={handleImported} />;

  return <main className="app-shell">
    <header className="app-header">
      <button className="brand-button" type="button" onClick={() => setView("atlas")}><span>BW</span><strong>BODY WEATHER<small>EXPERIENCE ATLAS</small></strong></button>
      <nav aria-label="주요 화면"><button aria-current={view === "atlas" ? "page" : undefined} className={view === "atlas" ? "active" : ""} onClick={() => setView("atlas")}>Atlas</button><button aria-current={view === "forecast" ? "page" : undefined} className={view === "forecast" ? "active" : ""} onClick={() => setView("forecast")}>Forecast</button><button aria-current={view === "memories" ? "page" : undefined} className={view === "memories" ? "active" : ""} onClick={() => setView("memories")}>Memories</button><button aria-current={view === "data" ? "page" : undefined} className={view === "data" ? "active" : ""} onClick={() => setView("data")}>Data & Privacy</button></nav>
      <button className="reset-button" type="button" onClick={() => { setSummary(null); setFullAtlas(buildAtlasModel([], true)); setSelectedRoute(null); setFocusCoordinate(null); }}>새 ZIP</button>
    </header>
    {view === "atlas" && <AtlasView summary={summary} colorMode={colorMode} setColorMode={setColorMode} filteredActivities={filteredActivities} rangeStart={rangeStart} rangeEnd={rangeEnd} setRangeStart={setRangeStart} setRangeEnd={setRangeEnd} typeFilter={typeFilter} setTypeFilter={setTypeFilter} reveal={reveal} setReveal={setReveal} selectedRoute={selectedRoute} setSelectedRoute={setSelectedRoute} focusCoordinate={focusCoordinate} onOpenForecast={() => setView("forecast")} fullAtlas={fullAtlas} />}
    {view === "forecast" && <ForecastView summary={summary} />}
    {view === "memories" && <MemoriesView summary={summary} atlas={fullAtlas} onOpenMemory={openMemory} />}
    {view === "data" && <DataView summary={summary} atlas={fullAtlas} />}
    {selectedRoute && <ActivityDrawer route={selectedRoute} onClose={() => setSelectedRoute(null)} />}
  </main>;
}
