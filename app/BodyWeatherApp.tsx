"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { calculateCorrelation, recoveryScore, type CorrelationMetric, type PerformanceMetric } from "@/lib/analytics";
import { importHealthArchives } from "@/lib/importer";
import { buildVerificationSummary } from "@/lib/verification-fixture";
import type { Activity, Capability, DailyWellness, ImportSummary, MetricValue, RoutePoint } from "@/lib/types";

type View = "weather" | "climate" | "lab" | "data";
type Layer = "effort" | "heart" | "power" | "recovery";

const LAYER_INFO: Record<Layer, { label: string; capability: string; color: string }> = {
  effort: { label: "Effort Front", capability: "effort", color: "#ff7d5c" },
  heart: { label: "Heart Heat", capability: "heart", color: "#ff4f9a" },
  power: { label: "Power Current", capability: "power", color: "#f6dd63" },
  recovery: { label: "Recovery Sky", capability: "recovery", color: "#67e8d4" },
};

function value(metric: MetricValue | undefined, digits = 0): string {
  if (!metric || metric.value === null) return "측정 없음";
  return `${metric.value.toLocaleString("ko-KR", { maximumFractionDigits: digits })} ${metric.unit}`.trim();
}

function hours(metric: MetricValue | undefined): string {
  if (!metric || metric.value === null) return "측정 없음";
  return `${(metric.value / 3600).toFixed(1)}시간`;
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(new Date(`${date}T12:00:00`));
}

function formatDuration(metric: MetricValue): string {
  if (metric.value === null) return "—";
  const hoursValue = Math.floor(metric.value / 3600);
  const minutesValue = Math.round((metric.value % 3600) / 60);
  return hoursValue ? `${hoursValue}시간 ${minutesValue}분` : `${minutesValue}분`;
}

function WeatherCanvas({ activities, wellness, layer, selectedDate, onSelectActivity }: {
  activities: Activity[]; wellness: DailyWellness[]; layer: Layer; selectedDate: string; onSelectActivity: (activity: Activity) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const selectedActivities = useMemo(() => activities.filter((activity) => activity.localDate === selectedDate), [activities, selectedDate]);
  const points = useMemo(() => selectedActivities.flatMap((activity) => activity.route ?? []), [selectedActivities]);
  const selectedWellness = wellness.find((day) => day.date === selectedDate);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stopped = false;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const scale = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(rect.width * scale));
      canvas.height = Math.max(1, Math.floor(rect.height * scale));
      context.setTransform(scale, 0, 0, scale, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const render = (time: number) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      context.clearRect(0, 0, width, height);
      const layerColor = LAYER_INFO[layer].color;
      const gradient = context.createRadialGradient(width * 0.56, height * 0.45, 20, width * 0.5, height * 0.5, width * 0.72);
      gradient.addColorStop(0, `${layerColor}25`);
      gradient.addColorStop(0.35, "rgba(21, 56, 73, .42)");
      gradient.addColorStop(1, "rgba(3, 11, 18, .96)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      context.strokeStyle = "rgba(132, 190, 200, .08)";
      context.lineWidth = 1;
      for (let x = -height; x < width + height; x += 54) {
        context.beginPath(); context.moveTo(x, 0); context.lineTo(x + height, height); context.stroke();
      }
      if (points.length > 1) {
        const minLat = Math.min(...points.map((point) => point.latitude));
        const maxLat = Math.max(...points.map((point) => point.latitude));
        const minLon = Math.min(...points.map((point) => point.longitude));
        const maxLon = Math.max(...points.map((point) => point.longitude));
        const latSpan = Math.max(0.001, maxLat - minLat);
        const lonSpan = Math.max(0.001, maxLon - minLon);
        const pad = 70;
        const project = (point: RoutePoint) => ({ x: pad + ((point.longitude - minLon) / lonSpan) * Math.max(1, width - pad * 2), y: height - pad - ((point.latitude - minLat) / latSpan) * Math.max(1, height - pad * 2) });
        context.shadowColor = layerColor; context.shadowBlur = 18; context.lineWidth = 3; context.strokeStyle = layerColor; context.beginPath();
        points.forEach((point, index) => { const projected = project(point); if (index === 0) context.moveTo(projected.x, projected.y); else context.lineTo(projected.x, projected.y); });
        context.stroke(); context.shadowBlur = 0;
        const particleCount = Math.min(28, Math.max(8, Math.round(points.length / 40)));
        for (let index = 0; index < particleCount; index += 1) {
          const progress = ((time / 6500 + index / particleCount) % 1) * (points.length - 1);
          const point = project(points[Math.floor(progress)]);
          context.beginPath(); context.arc(point.x, point.y, 2.3, 0, Math.PI * 2); context.fillStyle = "rgba(255,255,255,.9)"; context.fill();
        }
      } else {
        const recovery = recoveryScore(selectedWellness).value ?? 50;
        const effort = selectedActivities.reduce((sum, activity) => sum + (activity.trainingLoad.value ?? activity.relativeEffort.value ?? 0), 0);
        for (let index = 0; index < 26; index += 1) {
          const angle = index * 2.399 + time / (reduced ? 1e12 : 8500);
          const radius = 42 + index * Math.min(width, height) / 80;
          const x = width / 2 + Math.cos(angle) * radius * 1.5;
          const y = height / 2 + Math.sin(angle) * radius * 0.75;
          const alpha = 0.16 + Math.min(0.58, (layer === "recovery" ? recovery : effort) / 180);
          context.fillStyle = `${layerColor}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
          context.beginPath(); context.arc(x, y, 3 + (index % 4), 0, Math.PI * 2); context.fill();
        }
      }
      if (!stopped && !reduced) frameRef.current = requestAnimationFrame(render);
    };
    render(0);
    return () => { stopped = true; observer.disconnect(); cancelAnimationFrame(frameRef.current); };
  }, [layer, points, selectedActivities, selectedWellness]);

  return <div className="weather-canvas-wrap">
    <canvas ref={canvasRef} className="weather-canvas" aria-label={`${selectedDate} ${LAYER_INFO[layer].label} 시각화`} />
    <div className="map-grid-labels" aria-hidden="true"><span>BODY WEATHER / {selectedDate}</span><span>{points.length ? `${points.length.toLocaleString()} route points` : "CLIMATE FIELD"}</span></div>
    <div className="weather-legend"><i style={{ background: LAYER_INFO[layer].color }} /><span>{LAYER_INFO[layer].label}</span><small>낮음</small><b /><small>높음</small></div>
    {selectedActivities.length > 0 && <div className="activity-pins">{selectedActivities.map((activity) => <button key={activity.id} type="button" onClick={() => onSelectActivity(activity)}><span>{activity.type}</span><strong>{activity.name}</strong><small>{value(activity.distance, 1)} · {formatDuration(activity.movingTime)}</small></button>)}</div>}
  </div>;
}

function MetricCard({ label, metric, accent }: { label: string; metric?: MetricValue; accent?: string }) {
  return <div className="metric-card" style={{ "--metric-accent": accent ?? "#77e8db" } as React.CSSProperties}><span>{label}</span><strong>{value(metric, 1)}</strong><small>{metric?.value === null || !metric ? "데이터 없음" : `${metric.status} · ${Math.round(metric.confidence * 100)}% 신뢰`}</small></div>;
}

function ImportScreen({ onImported }: { onImported: (summary: ImportSummary) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [startDate, setStartDate] = useState("2026-04-01");
  const [endDate, setEndDate] = useState("2026-07-12");
  const [stage, setStage] = useState("ZIP을 선택하면 모든 처리는 이 브라우저 안에서 시작됩니다.");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const importFiles = async () => {
    if (files.length === 0) return;
    setBusy(true); setError("");
    try {
      const summary = await importHealthArchives(files, { startDate, endDate, onProgress(nextStage, nextProgress) { setStage(nextStage); setProgress(nextProgress); } });
      if (summary.activities.length === 0 && summary.wellness.length === 0) throw new Error("지원 가능한 운동 또는 웰니스 데이터가 없습니다.");
      onImported(summary);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "가져오기를 완료하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <main className="import-shell">
    <section className="import-hero"><div className="brand-mark">BW</div><p className="eyebrow">PRIVATE TRAINING CLIMATE</p><h1>당신의 몸에도<br /><em>날씨가 흐릅니다.</em></h1><p className="hero-copy">Strava의 움직임과 Garmin의 회복 신호를 겹쳐, 훈련과 수면 사이에 숨어 있던 개인 기후를 발견하세요.</p><div className="privacy-note"><span>LOCAL FIRST</span> ZIP과 건강 원본은 서버에 저장하거나 전송하지 않습니다.</div></section>
    <section className="import-card" aria-labelledby="import-title"><div><p className="step-label">01 / DATA INTAKE</p><h2 id="import-title">내보내기 ZIP 가져오기</h2><p>Strava, Garmin 중 하나만 있어도 시작할 수 있습니다. 비어 있는 필드는 0으로 만들지 않고 가능한 기능만 구성합니다.</p></div>
      <label className="drop-zone" htmlFor="archive-files"><input id="archive-files" data-testid="archive-input" type="file" accept=".zip,application/zip" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /><span className="drop-icon">＋</span><strong>ZIP 파일 선택</strong><small>사진과 영상은 자동으로 제외됩니다.</small></label>
      {files.length > 0 && <ul className="file-list">{files.map((file) => <li key={`${file.name}-${file.size}`}><span>{file.name}</span><b>{(file.size / 1024 / 1024).toFixed(1)} MB</b></li>)}</ul>}
      <div className="date-fields"><label>시작일<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>종료일<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label></div>
      {busy && <div className="progress-panel" role="status"><div><span style={{ width: `${Math.max(4, progress * 100)}%` }} /></div><p>{stage}</p></div>}{error && <p className="error-message" role="alert">{error}</p>}
      <button className="primary-action" data-testid="import-action" type="button" disabled={!files.length || busy} onClick={importFiles}>{busy ? "개인 기후 생성 중…" : "Body Weather 만들기"}</button><p className="security-copy">ZIP Slip, 비정상 압축률, 과도한 파일 크기를 검사하며 손상된 한 소스가 다른 정상 데이터를 막지 않습니다.</p>
    </section>
  </main>;
}

function CapabilityStrip({ capabilities }: { capabilities: Capability[] }) {
  return <div className="capability-strip" aria-label="활성 데이터 기능">{capabilities.map((capability) => <span key={capability.key} className={capability.state} title={capability.reason}><i />{capability.label}<b>{Math.round(capability.coverage * 100)}%</b></span>)}</div>;
}

function DayPanel({ date, activities, wellness, onClose }: { date: string; activities: Activity[]; wellness?: DailyWellness; onClose: () => void }) {
  const recovery = recoveryScore(wellness);
  return <aside className="detail-panel" aria-label={`${date} 날짜 상세`}><button className="panel-close" type="button" onClick={onClose} aria-label="날짜 상세 닫기">×</button><p className="eyebrow">DAY ATMOSPHERE</p><h2>{formatDate(date)}</h2><div className="recovery-orb"><strong>{recovery.value ?? "—"}</strong><span>회복 기후</span><small>신뢰도 {recovery.confidence}</small></div><p className="panel-copy">{recovery.inputs.length ? `${recovery.inputs.join(" · ")} 기반으로 구성했습니다.` : "회복 측정값이 없어 운동 기록 중심으로 보여줍니다."}</p><div className="day-flow"><section><span>전날 밤</span><strong>{hours(wellness?.sleep?.totalSeconds)}</strong><small>수면 · {value(wellness?.sleep?.score)}</small></section><section><span>운동 전</span><strong>{value(wellness?.bodyBatteryHigh)}</strong><small>HRV · {value(wellness?.hrv)}</small></section><section><span>당일 운동</span><strong>{activities.length}개 활동</strong><small>{activities.length ? `부하 · ${activities.reduce((sum, activity) => sum + (activity.trainingLoad.value ?? activity.relativeEffort.value ?? 0), 0).toFixed(0)}` : "활동 없음"}</small></section><section><span>하루 회복</span><strong>{value(wellness?.bodyBatteryDrained)}</strong><small>스트레스 · {value(wellness?.averageStress)}</small></section></div></aside>;
}

function ActivityPanel({ activity, onClose }: { activity: Activity; onClose: () => void }) {
  return <aside className="detail-panel activity-panel" aria-label={`${activity.name} 활동 상세`}><button className="panel-close" type="button" onClick={onClose} aria-label="활동 상세 닫기">×</button><p className="eyebrow">ACTIVITY CURRENT</p><h2>{activity.name}</h2><p className="panel-copy">{activity.type} · {formatDate(activity.localDate)} · {activity.route?.length ? `${activity.streamCount?.toLocaleString()}개 원본 경로점` : "시계열 없이 요약 지표로 표시"}</p><div className="activity-metrics"><MetricCard label="거리" metric={activity.distance} /><MetricCard label="이동 시간" metric={activity.movingTime} /><MetricCard label="평균 심박" metric={activity.averageHeartRate} accent="#ff4f9a" /><MetricCard label="평균 파워" metric={activity.averagePower} accent="#f6dd63" /><MetricCard label="Training Load" metric={activity.trainingLoad} accent="#ff7d5c" /><MetricCard label="강도" metric={activity.intensity} /></div><div className="source-block"><span>데이터 출처</span><code>{activity.source} · {activity.sourceFile}</code><small>누락된 지표는 0이 아닌 “측정 없음”으로 유지됩니다.</small></div></aside>;
}

function ClimateView({ summary, onGoToDate }: { summary: ImportSummary; onGoToDate: (date: string) => void }) {
  const ranked = [...summary.activities].sort((a, b) => (b.trainingLoad.value ?? b.relativeEffort.value ?? 0) - (a.trainingLoad.value ?? a.relativeEffort.value ?? 0));
  const bestRecovery = [...summary.wellness].map((day) => ({ day, score: recoveryScore(day).value })).filter((item) => item.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  const totalDistance = summary.activities.reduce((sum, activity) => sum + (activity.distance.value ?? 0), 0);
  return <section className="content-view climate-view"><header><p className="eyebrow">PERSONAL CLIMATE</p><h1>당신의 계절은<br />숫자보다 선명합니다.</h1><p>{summary.startDate} — {summary.endDate} 동안 측정된 기록만으로 만든 개인 기후 리포트입니다.</p></header><div className="climate-hero-card hot"><span>가장 거센 부하 전선</span><strong>{ranked[0] ? formatDate(ranked[0].localDate) : "기록 없음"}</strong><p>{ranked[0]?.name ?? "운동 데이터가 없습니다."}</p>{ranked[0] && <button onClick={() => onGoToDate(ranked[0].localDate)}>그날로 이동 →</button>}</div><div className="climate-hero-card cool"><span>가장 맑은 회복일</span><strong>{bestRecovery ? formatDate(bestRecovery.day.date) : "측정 없음"}</strong><p>{bestRecovery ? `회복 기후 ${bestRecovery.score}` : "회복 데이터가 충분하지 않습니다."}</p>{bestRecovery && <button onClick={() => onGoToDate(bestRecovery.day.date)}>그날로 이동 →</button>}</div><div className="climate-stat"><span>총 이동 거리</span><strong>{totalDistance.toFixed(1)} km</strong></div><div className="climate-stat"><span>활동 일수</span><strong>{new Set(summary.activities.map((activity) => activity.localDate)).size}일</strong></div><div className="climate-stat"><span>회복 관측일</span><strong>{summary.wellness.length}일</strong></div><div className="climate-list"><h2>부하가 높았던 활동</h2>{ranked.slice(0, 6).map((activity, index) => <button key={activity.id} onClick={() => onGoToDate(activity.localDate)}><b>0{index + 1}</b><span>{activity.name}<small>{activity.type} · {activity.localDate}</small></span><strong>{value(activity.trainingLoad.value !== null ? activity.trainingLoad : activity.relativeEffort)}</strong></button>)}</div></section>;
}

function LabView({ summary }: { summary: ImportSummary }) {
  const [xKey, setXKey] = useState<CorrelationMetric>("sleep"); const [yKey, setYKey] = useState<PerformanceMetric>("effort"); const [type, setType] = useState("all");
  const result = useMemo(() => calculateCorrelation(summary.activities, summary.wellness, xKey, yKey, type), [summary, xKey, yKey, type]);
  const types = [...new Set(summary.activities.map((activity) => activity.type))];
  return <section className="content-view lab-view"><header><p className="eyebrow">CORRELATION LAB</p><h1>함께 움직인 신호를<br />조심스럽게 읽습니다.</h1><p>상관관계는 원인이 아닙니다. 측정된 날짜의 연관성과 불확실성을 함께 보여줍니다.</p></header><div className="lab-controls"><label>회복 신호<select value={xKey} onChange={(event) => setXKey(event.target.value as CorrelationMetric)}><option value="sleep">수면 시간</option><option value="hrv">HRV</option><option value="battery">Body Battery</option><option value="stress">평균 스트레스</option></select></label><label>운동 지표<select value={yKey} onChange={(event) => setYKey(event.target.value as PerformanceMetric)}><option value="effort">운동 부하</option><option value="heart">평균 심박</option><option value="power">평균 파워</option><option value="distance">거리</option></select></label><label>종목<select value={type} onChange={(event) => setType(event.target.value)}><option value="all">전체 종목</option>{types.map((item) => <option key={item}>{item}</option>)}</select></label></div><div className="correlation-card"><span>PEARSON CORRELATION</span><strong>{result.coefficient === null ? "표본 부족" : result.coefficient.toFixed(2)}</strong><p>{result.coefficient === null ? "신뢰할 수 있는 결과를 위해 최소 5개의 날짜쌍이 필요합니다." : `${result.direction === "positive" ? "양의" : result.direction === "negative" ? "음의" : "뚜렷하지 않은"} 연관성이 관찰되었습니다.`}</p><div><span>표본 <b>{result.sampleSize}</b></span><span>결측률 <b>{Math.round(result.missingRate * 100)}%</b></span><span>95% 구간 <b>{result.confidenceLow === null ? "—" : `${result.confidenceLow.toFixed(2)} ~ ${result.confidenceHigh?.toFixed(2)}`}</b></span></div></div><aside className="lab-note"><strong>해석 원칙</strong><p>개인 기준선은 기간 안의 측정값으로만 설명하며, 의료 진단이나 훈련 처방을 제공하지 않습니다. 서로 다른 종목의 파워와 페이스는 직접 비교하지 않습니다.</p></aside></section>;
}

function DataView({ summary }: { summary: ImportSummary }) {
  const days = useMemo(() => { const values: string[] = []; const cursor = new Date(`${summary.startDate}T12:00:00`); const end = new Date(`${summary.endDate}T12:00:00`); while (cursor <= end) { values.push(cursor.toISOString().slice(0, 10)); cursor.setDate(cursor.getDate() + 1); } return values; }, [summary]);
  const activityDates = new Set(summary.activities.map((activity) => activity.localDate)); const wellnessDates = new Set(summary.wellness.map((day) => day.date));
  return <section className="content-view data-view"><header><p className="eyebrow">DATA MAP</p><h1>무엇을 알고,<br />무엇을 모르는지.</h1><p>센서 공백과 출처를 숨기지 않습니다. 비어 있는 날짜는 실패가 아니라 현재 데이터의 경계입니다.</p></header><CapabilityStrip capabilities={summary.capabilityProfile.capabilities} /><div className="coverage-calendar" aria-label="날짜별 데이터 존재율">{days.map((day) => <span key={day} className={`${activityDates.has(day) ? "has-activity" : ""} ${wellnessDates.has(day) ? "has-wellness" : ""}`} title={`${day}: 운동 ${activityDates.has(day) ? "있음" : "없음"}, 회복 ${wellnessDates.has(day) ? "있음" : "없음"}`} />)}</div><div className="coverage-legend"><span><i className="activity" />운동</span><span><i className="wellness" />회복</span><span><i className="both" />둘 다</span><span><i />데이터 없음</span></div><div className="data-summary-grid"><div><span>활동</span><strong>{summary.activities.length}</strong></div><div><span>웰니스 일수</span><strong>{summary.wellness.length}</strong></div><div><span>미디어 제외</span><strong>{summary.mediaSkipped}</strong></div><div><span>진단 항목</span><strong>{summary.issues.length}</strong></div></div><div className="issue-list"><h2>가져오기 진단</h2>{summary.issues.length ? summary.issues.slice(0, 30).map((issue) => <div key={issue.id} className={issue.severity}><span>{issue.code}</span><p>{issue.message}</p><b>{issue.recoverable ? "복구됨" : "확인 필요"}</b></div>) : <p className="empty-state">해석 오류 없이 가져왔습니다.</p>}</div><div className="source-table"><h2>원본 무결성 식별자</h2><p>256MB 이하 파일은 SHA-256, 대용량 파일은 크기와 수정시각을 기록합니다. 원본은 읽기만 하며 서버로 전송하지 않습니다.</p>{Object.entries(summary.sourceHashes ?? {}).map(([name, hash]) => <div key={name}><span>{name}</span><code>{hash}</code></div>)}</div></section>;
}

export default function BodyWeatherApp() {
  const [summary, setSummary] = useState<ImportSummary | null>(null); const [view, setView] = useState<View>("weather"); const [layer, setLayer] = useState<Layer>("effort"); const [selectedDate, setSelectedDate] = useState(""); const [playing, setPlaying] = useState(false); const [showDay, setShowDay] = useState(false); const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const timeline = useMemo(() => { if (!summary) return []; const dates = new Set([...summary.activities.map((activity) => activity.localDate), ...summary.wellness.map((day) => day.date)]); return [...dates].sort(); }, [summary]);
  useEffect(() => { if (!playing || timeline.length < 2) return; const timer = window.setInterval(() => { setSelectedDate((current) => { const index = timeline.indexOf(current); return timeline[(index + 1) % timeline.length]; }); }, 1100); return () => window.clearInterval(timer); }, [playing, timeline]);
  const handleImported = useCallback((result: ImportSummary) => { setSummary(result); setSelectedDate(result.activities.at(-1)?.localDate ?? result.wellness.at(-1)?.date ?? result.endDate); }, []);
  useEffect(() => {
    if (window.location.hostname === "localhost" && new URLSearchParams(window.location.search).get("__fixture") === "full") {
      const timer = window.setTimeout(() => handleImported(buildVerificationSummary()), 0);
      return () => window.clearTimeout(timer);
    }
  }, [handleImported]);
  if (!summary) return <ImportScreen onImported={handleImported} />;
  const currentIndex = Math.max(0, timeline.indexOf(selectedDate)); const activeCapabilities = new Map(summary.capabilityProfile.capabilities.map((item) => [item.key, item])); const currentActivities = summary.activities.filter((activity) => activity.localDate === selectedDate); const currentWellness = summary.wellness.find((day) => day.date === selectedDate);
  const goToDate = (date: string) => { setSelectedDate(date); setView("weather"); setShowDay(true); };
  return <main className="app-shell"><header className="app-header"><button className="brand-button" type="button" onClick={() => setView("weather")}><span>BW</span><strong>BODY WEATHER</strong></button><nav aria-label="주요 화면"><button className={view === "weather" ? "active" : ""} onClick={() => setView("weather")}>Weather</button><button className={view === "climate" ? "active" : ""} onClick={() => setView("climate")}>Climate</button><button className={view === "lab" ? "active" : ""} onClick={() => setView("lab")}>Correlation Lab</button><button className={view === "data" ? "active" : ""} onClick={() => setView("data")}>Data Map</button></nav><button className="reset-button" type="button" onClick={() => { setSummary(null); setPlaying(false); }}>새 ZIP</button></header>
    {view === "weather" && <section className="weather-view"><WeatherCanvas activities={summary.activities} wellness={summary.wellness} layer={layer} selectedDate={selectedDate} onSelectActivity={setSelectedActivity} /><div className="weather-title"><p className="eyebrow">LIVE PERSONAL CLIMATE</p><h1>{formatDate(selectedDate)}</h1><button type="button" onClick={() => setShowDay(true)}>하루 기후 자세히 ↗</button></div><div className="layer-switcher" aria-label="기상 레이어">{(Object.keys(LAYER_INFO) as Layer[]).map((item) => { const info = LAYER_INFO[item]; const capability = activeCapabilities.get(info.capability); const disabled = capability?.state === "unavailable"; return <button key={item} type="button" disabled={disabled} className={layer === item ? "active" : ""} onClick={() => setLayer(item)} title={disabled ? capability.reason : info.label}><i style={{ background: info.color }} /><span>{info.label}</span><small>{disabled ? "측정 없음" : capability?.state === "partial" ? "일부 날짜" : "활성"}</small></button>; })}</div><div className="weather-kpis"><div><span>운동</span><strong>{currentActivities.length}</strong><small>activities</small></div><div><span>회복 기후</span><strong>{recoveryScore(currentWellness).value ?? "—"}</strong><small>{recoveryScore(currentWellness).confidence} 신뢰</small></div><div><span>수면</span><strong>{hours(currentWellness?.sleep?.totalSeconds)}</strong><small>{value(currentWellness?.sleep?.score)}</small></div><div><span>HRV</span><strong>{value(currentWellness?.hrv)}</strong><small>{currentWellness?.hrv.status ?? "missing"}</small></div></div><div className="timeline-panel"><button className="play-button" data-testid="timeline-play" type="button" onClick={() => setPlaying((current) => !current)} aria-label={playing ? "시간 재생 일시정지" : "시간 재생"}>{playing ? "Ⅱ" : "▶"}</button><div><span>{summary.startDate}</span><input data-testid="timeline-range" aria-label="분석 날짜" type="range" min="0" max={Math.max(0, timeline.length - 1)} value={currentIndex} onChange={(event) => setSelectedDate(timeline[Number(event.target.value)])} /><span>{summary.endDate}</span></div><strong>{selectedDate}</strong></div></section>}
    {view === "climate" && <ClimateView summary={summary} onGoToDate={goToDate} />}{view === "lab" && <LabView summary={summary} />}{view === "data" && <DataView summary={summary} />}{showDay && <DayPanel date={selectedDate} activities={currentActivities} wellness={currentWellness} onClose={() => setShowDay(false)} />}{selectedActivity && <ActivityPanel activity={selectedActivity} onClose={() => setSelectedActivity(null)} />}
  </main>;
}
