import { useMemo } from 'react';
import type {
  SessionConfig,
  MeasurementReading,
  EventTag,
  ScoreLevel,
  Severity,
  BenchmarkExport,
  Recommendation,
} from '../types';
import { scoreReading, computeSessionScore } from '../lib/scoring';
import {
  generateRecommendations,
  generateLoadTestRecommendations,
} from '../lib/recommendations';
import {
  generateXLSXReport,
  generateCSV as generateCSVExport,
} from '../lib/xlsx-export';

interface ResultsScreenProps {
  config: SessionConfig;
  readings: MeasurementReading[];
  events: EventTag[];
  onNewSession: () => void;
}

// --- Helpers ---

function statusBorder(level: ScoreLevel): string {
  switch (level) {
    case 'good':
      return 'border-green-400';
    case 'fair':
      return 'border-amber-400';
    case 'poor':
      return 'border-red-400';
  }
}

function statusBgTint(level: ScoreLevel): string {
  switch (level) {
    case 'good':
      return 'bg-green-400/10';
    case 'fair':
      return 'bg-amber-400/10';
    case 'poor':
      return 'bg-red-400/10';
  }
}

function statusText(level: ScoreLevel): string {
  switch (level) {
    case 'good':
      return 'text-green-400';
    case 'fair':
      return 'text-amber-400';
    case 'poor':
      return 'text-red-400';
  }
}

function severityBg(severity: Severity): string {
  switch (severity) {
    case 'high':
      return 'bg-red-400/15 border-red-400/40';
    case 'medium':
      return 'bg-amber-400/15 border-amber-400/40';
    case 'informational':
      return 'bg-green-400/15 border-green-400/40';
  }
}

function severityBadge(severity: Severity): string {
  switch (severity) {
    case 'high':
      return 'bg-red-500 text-white';
    case 'medium':
      return 'bg-amber-500 text-black';
    case 'informational':
      return 'bg-green-500 text-black';
  }
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m${s > 0 ? String(s).padStart(2, '0') + 's' : ''}`;
}

function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function scoreMetric(
  value: number,
  metric: 'download' | 'latency' | 'jitter',
): ScoreLevel {
  // Simplified scoring for individual metric cards
  const thresholds = {
    download: { good: 30, fair: 10 },
    latency: { good: 50, fair: 100 },
    jitter: { good: 15, fair: 30 },
  };
  const t = thresholds[metric];
  if (metric === 'download') {
    if (value >= t.good) return 'good';
    if (value >= t.fair) return 'fair';
    return 'poor';
  }
  // latency & jitter: lower is better
  if (value < t.good) return 'good';
  if (value <= t.fair) return 'fair';
  return 'poor';
}

function buildBenchmarkExport(
  config: SessionConfig,
  readings: MeasurementReading[],
  events: EventTag[],
  sessionScore: ReturnType<typeof computeSessionScore>,
  recommendations: Recommendation[],
): BenchmarkExport {
  const durationMs =
    readings.length >= 2
      ? readings[readings.length - 1].timestamp - readings[0].timestamp
      : 0;

  return {
    schema_version: '2.0',
    submitted_at: new Date().toISOString(),
    session: {
      id: config.id,
      mode: config.mode,
      date: new Date(config.startTime).toISOString(),
      duration_minutes: round(durationMs / 60000),
      readings_count: readings.length,
    },
    event: {
      games: config.games,
      devices: config.devices,
      player_count: config.playerCount,
    },
    venue: { ...config.venue },
    network: {
      isp: config.network.isp,
      connection_type: config.network.connectionType,
      router_model: config.network.routerModel,
      access_points: config.network.accessPoints,
    },
    passive_scan: config.passiveScan
      ? {
          rssi_dbm: config.passiveScan.rssiDbm,
          band: config.passiveScan.band,
          same_channel_networks: config.passiveScan.sameChannelNetworks,
          total_visible_networks: config.passiveScan.totalVisibleNetworks,
        }
      : null,
    measurements: {
      summary: {
        avg_download: round(sessionScore.metrics.avgDownload),
        min_download: round(sessionScore.metrics.minDownload),
        max_download: round(sessionScore.metrics.maxDownload),
        avg_upload: round(sessionScore.metrics.avgUpload),
        avg_latency: round(sessionScore.metrics.avgLatency),
        max_latency: round(sessionScore.metrics.maxLatency),
        avg_jitter: round(sessionScore.metrics.avgJitter),
        avg_stability: round(sessionScore.metrics.avgStability),
        per_device_bandwidth: round(sessionScore.metrics.perDeviceBandwidth),
      },
      readings: readings.map((r) => ({
        timestamp: new Date(r.timestamp).toISOString(),
        elapsed_minutes: round(r.elapsedMs / 60000),
        download: round(r.download),
        upload: round(r.upload),
        latency: round(r.latency),
        jitter: round(r.jitter),
        stability: round(r.stability),
      })),
    },
    events: events.map((e) => ({
      timestamp: new Date(e.timestamp).toISOString(),
      elapsed_minutes: round(e.elapsedMs / 60000),
      type: e.type,
    })),
    calibration: {
      browser_p50: 0,
      browser_p95: 0,
      browser_iqr: 0,
      variance_reliable: true,
    },
    scoring: {
      overall: sessionScore.overall,
      per_device_bandwidth: round(sessionScore.metrics.perDeviceBandwidth),
      recommendations: recommendations.map((r) => ({
        severity: r.severity,
        trigger: r.trigger,
        message: r.message,
      })),
    },
  };
}

function downloadFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  downloadBlob(blob, filename);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// --- Component ---

export default function Results({
  config,
  readings,
  events,
  onNewSession,
}: ResultsScreenProps) {
  const sessionScore = useMemo(
    () =>
      computeSessionScore(
        readings,
        events,
        config.playerCount,
        config.passiveScan,
      ),
    [readings, events, config.playerCount, config.passiveScan],
  );

  const recommendations = useMemo(() => {
    if (config.mode === 'load_test') {
      return generateLoadTestRecommendations(readings, config.playerCount);
    }
    return generateRecommendations(
      sessionScore,
      events,
      readings,
      config.playerCount,
      config.network.accessPoints,
      config.passiveScan,
    );
  }, [sessionScore, events, readings, config]);

  const durationMs =
    readings.length >= 2
      ? readings[readings.length - 1].timestamp - readings[0].timestamp
      : 0;

  const maxDownload = Math.max(...readings.map((r) => r.download), 1);

  // Build set of reading IDs correlated with lag/disconnect events
  const eventReadingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const corr of sessionScore.eventCorrelations) {
      if (corr.eventType === 'lag_reported' || corr.eventType === 'disconnect') {
        ids.add(corr.readingId);
      }
    }
    return ids;
  }, [sessionScore.eventCorrelations]);

  const modeLabel =
    config.mode === 'load_test' ? 'Load Test' : 'Event Monitor';

  // --- Metric cards data ---
  const metricCards: {
    label: string;
    value: string;
    unit: string;
    level: ScoreLevel;
  }[] = [
    {
      label: 'Avg Download',
      value: round(sessionScore.metrics.avgDownload).toString(),
      unit: 'Mbps',
      level: scoreMetric(sessionScore.metrics.avgDownload, 'download'),
    },
    {
      label: 'Avg Latency',
      value: round(sessionScore.metrics.avgLatency).toString(),
      unit: 'ms',
      level: scoreMetric(sessionScore.metrics.avgLatency, 'latency'),
    },
    {
      label: 'Min Download',
      value: round(sessionScore.metrics.minDownload).toString(),
      unit: 'Mbps',
      level: scoreMetric(sessionScore.metrics.minDownload, 'download'),
    },
    {
      label: 'Max Latency',
      value: round(sessionScore.metrics.maxLatency).toString(),
      unit: 'ms',
      level: scoreMetric(sessionScore.metrics.maxLatency, 'latency'),
    },
    {
      label: 'Avg Jitter',
      value: round(sessionScore.metrics.avgJitter).toString(),
      unit: 'ms',
      level: scoreMetric(sessionScore.metrics.avgJitter, 'jitter'),
    },
    {
      label: 'Per-Device BW',
      value: round(sessionScore.metrics.perDeviceBandwidth).toString(),
      unit: 'Mbps',
      level: scoreMetric(sessionScore.metrics.perDeviceBandwidth, 'download'),
    },
    {
      label: 'Events Logged',
      value: events.length.toString(),
      unit: '',
      level: events.filter((e) => e.type === 'disconnect').length > 0 ? 'poor' : 'good',
    },
  ];

  // --- Export handlers ---

  function handleExportJSON(): void {
    const data = buildBenchmarkExport(
      config,
      readings,
      events,
      sessionScore,
      recommendations,
    );
    downloadFile(
      JSON.stringify(data, null, 2),
      `benchmark-${config.id}.json`,
      'application/json',
    );
  }

  function handleExportXLSX(): void {
    const blob = generateXLSXReport(
      config,
      readings,
      events,
      sessionScore,
      recommendations,
    );
    downloadBlob(blob, `report-${config.id}.xlsx`);
  }

  function handleExportCSV(): void {
    const blob = generateCSVExport(config, readings, events);
    downloadBlob(blob, `report-${config.id}.csv`);
  }

  function handleContributeBenchmark(): void {
    // Placeholder — POST to benchmark API
    alert(
      'Benchmark contribution is not yet available. This will POST session data to the community benchmark API in a future update.',
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 pb-24 space-y-6">
      {/* 1. Session Summary Header */}
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold">Session Results</h1>
        <p className="text-lg text-gray-300">{config.venue.name}</p>
        <p className="text-sm text-gray-500">
          {formatDate(config.startTime)} · {formatDuration(durationMs)} ·{' '}
          {config.playerCount} players · {modeLabel}
        </p>
        <div className="mt-2">
          <span
            className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${
              sessionScore.overall === 'good'
                ? 'bg-green-500/20 text-green-400'
                : sessionScore.overall === 'fair'
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'bg-red-500/20 text-red-400'
            }`}
          >
            Overall: {sessionScore.overall.charAt(0).toUpperCase() + sessionScore.overall.slice(1)}
          </span>
        </div>
      </div>

      {/* 2. Key Metrics Card Grid */}
      <div className="grid grid-cols-2 gap-3">
        {metricCards.map((card) => (
          <div
            key={card.label}
            className={`rounded-lg border-l-4 ${statusBorder(card.level)} ${statusBgTint(card.level)} bg-white/5 p-3`}
          >
            <p className="text-xs text-gray-400 uppercase tracking-wide">
              {card.label}
            </p>
            <p className={`text-2xl font-bold ${statusText(card.level)}`}>
              {card.value}
              {card.unit && (
                <span className="text-sm font-normal text-gray-400 ml-1">
                  {card.unit}
                </span>
              )}
            </p>
          </div>
        ))}
      </div>

      {/* 3. Download Speed Timeline */}
      {readings.length > 0 && (
        <div className="bg-white/5 rounded-lg p-4 space-y-2">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
            Download Speed Timeline
          </h2>
          <div className="flex items-end gap-[2px] h-48">
            {readings.map((reading, i) => {
              const score = scoreReading(reading);
              const heightPct = Math.min(
                100,
                (reading.download / maxDownload) * 100,
              );
              const color =
                score.download === 'good'
                  ? 'bg-green-500'
                  : score.download === 'fair'
                    ? 'bg-amber-500'
                    : 'bg-red-500';
              const hasEvent = eventReadingIds.has(reading.id);
              return (
                <div
                  key={reading.id}
                  className="flex-1 flex flex-col items-center justify-end h-full relative"
                >
                  {hasEvent && (
                    <div className="w-2 h-2 rounded-full bg-red-500 ring-2 ring-red-500/40 mb-1 shrink-0" />
                  )}
                  <div
                    className={`w-full ${color} rounded-t min-h-[2px]`}
                    style={{ height: `${heightPct}%` }}
                  />
                  {i % Math.max(1, Math.floor(readings.length / 6)) === 0 && (
                    <span className="text-[10px] text-gray-500 mt-1 whitespace-nowrap">
                      {formatElapsed(reading.elapsedMs)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Findings & Recommendations */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
          Findings & Recommendations
        </h2>
        {recommendations.map((rec) => (
          <div
            key={rec.id}
            className={`rounded-lg border-l-4 p-3 ${severityBg(rec.severity)}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${severityBadge(rec.severity)}`}
              >
                {rec.severity}
              </span>
              <span className="font-semibold text-sm">{rec.title}</span>
            </div>
            <p className="text-sm text-gray-300">{rec.message}</p>
          </div>
        ))}
      </div>

      {/* 5. Export Buttons */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
          Export
        </h2>
        <button
          onClick={handleExportXLSX}
          className="w-full py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-semibold text-sm transition-colors"
        >
          Download Report (XLSX)
        </button>
        <button
          onClick={handleExportCSV}
          className="w-full py-3 rounded-lg bg-white/10 hover:bg-white/15 font-semibold text-sm transition-colors border border-white/10"
        >
          Download Report (CSV)
        </button>
        <button
          onClick={handleContributeBenchmark}
          className="w-full py-3 rounded-lg bg-white/10 hover:bg-white/15 font-semibold text-sm transition-colors border border-white/10"
        >
          Contribute to Benchmark
        </button>
        <button
          onClick={handleExportJSON}
          className="w-full py-3 rounded-lg bg-white/10 hover:bg-white/15 font-semibold text-sm transition-colors border border-white/10"
        >
          Export Raw Data (JSON)
        </button>
      </div>

      {/* 6. New Session Button */}
      <button
        onClick={onNewSession}
        className="w-full py-3 rounded-lg bg-white/5 hover:bg-white/10 font-semibold text-sm transition-colors border border-white/20"
      >
        New Session
      </button>
    </div>
  );
}
