import * as XLSX from 'xlsx';
import type {
  MeasurementReading,
  EventTag,
  SessionConfig,
  Recommendation,
  SessionScore,
  CalibrationResult,
  BenchmarkExport,
  GameType,
  DeviceType,
  ScoreLevel,
} from '../types/index.ts';
import { scoreReading } from './scoring.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GAME_LABELS: Record<GameType, string> = {
  champions_switch: 'Champions (Switch)',
  champions_mobile: 'Champions (Mobile)',
  pokemon_go: 'Pokémon GO',
  tcg: 'TCG Live',
};

const DEVICE_LABELS: Record<DeviceType, string> = {
  switch: 'Switch',
  switch_oled: 'Switch OLED',
  switch_lite: 'Switch Lite',
  switch_2: 'Switch 2',
  iphone: 'iPhone',
  android: 'Android',
  tablet: 'Tablet',
};

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

function round(v: number, d = 1): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function elapsedMin(ms: number): number {
  return round(ms / 60_000);
}

function modeLabel(mode: string): string {
  return mode === 'load_test' ? 'Load Test' : 'Event Monitor';
}

function statusLabel(overall: ScoreLevel): string {
  return overall === 'good' ? 'Good' : overall === 'fair' ? 'Fair' : 'Poor';
}

function severityLabel(s: string): string {
  return s === 'high' ? 'High' : s === 'medium' ? 'Medium' : 'Info';
}

function storeVerdict(overall: ScoreLevel, playerCount: number): string {
  if (overall === 'good') return `Ready for events up to ${playerCount} players`;
  if (overall === 'fair') return 'Adequate for most events, but monitor for issues with larger groups';
  return 'Network improvements recommended before hosting competitive events';
}

function durationMinutes(readings: MeasurementReading[]): number {
  if (readings.length === 0) return 0;
  const last = readings[readings.length - 1];
  return Math.round(last.elapsedMs / 60_000);
}

// ---------------------------------------------------------------------------
// Sheet builders
// ---------------------------------------------------------------------------

function buildSessionInfoSheet(config: SessionConfig, readings: MeasurementReading[]): XLSX.WorkSheet {
  const rows: (string | number | null)[][] = [
    ['Event Details'],
    ['Venue', config.venue.name],
    ['City', `${config.venue.city}, ${config.venue.country}`],
    ['Date', fmtDate(config.startTime)],
    ['Duration', `${durationMinutes(readings)} minutes`],
    ['Games', config.games.map((g) => GAME_LABELS[g]).join(', ')],
    ['Devices', config.devices.map((d) => DEVICE_LABELS[d]).join(', ')],
    ['Player Count', config.playerCount],
    ['Session Mode', modeLabel(config.mode)],
    [],
    ['Network Info'],
    ['ISP', config.network.isp],
    ['Connection', config.network.connectionType],
    ['Router', config.network.routerModel],
    ['Access Points', config.network.accessPoints],
  ];

  if (config.passiveScan) {
    const ps = config.passiveScan;
    rows.push(
      [],
      ['WiFi Scan'],
      ['Signal', ps.rssiDbm !== null ? `${ps.rssiDbm} dBm` : 'N/A'],
      ['Band', ps.band],
      ['Same Channel Networks', ps.sameChannelNetworks ?? 'N/A'],
      ['Total Visible Networks', ps.totalVisibleNetworks ?? 'N/A'],
    );
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 24 }, { wch: 40 }];
  return ws;
}

function buildMeasurementsSheet(readings: MeasurementReading[]): XLSX.WorkSheet {
  const data = readings.map((r) => ({
    Time: fmtDate(r.timestamp),
    'Elapsed (min)': elapsedMin(r.elapsedMs),
    'Download (Mbps)': round(r.download),
    'Upload (Mbps)': round(r.upload),
    'Latency (ms)': round(r.latency),
    'Jitter (ms)': round(r.jitter),
    'Stability (%)': round(r.stability),
    Status: statusLabel(scoreReading(r).overall),
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [
    { wch: 22 },
    { wch: 14 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 14 },
    { wch: 10 },
  ];
  return ws;
}

function buildEventLogSheet(events: EventTag[]): XLSX.WorkSheet {
  const data = events.map((e) => ({
    Time: fmtDate(e.timestamp),
    'Elapsed (min)': elapsedMin(e.elapsedMs),
    'Event Type': e.type,
    Label: e.label,
  }));

  const ws = XLSX.utils.json_to_sheet(data.length > 0 ? data : [{ Time: '', 'Elapsed (min)': '', 'Event Type': '', Label: 'No events logged' }]);
  ws['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 18 }, { wch: 30 }];
  return ws;
}

function buildSummarySheet(
  sessionScore: SessionScore,
  recommendations: Recommendation[],
  readings: MeasurementReading[],
): XLSX.WorkSheet {
  const m = sessionScore.metrics;
  const rows: (string | number | null)[][] = [
    ['Summary & Findings'],
    [],
    ['Overall Score', statusLabel(sessionScore.overall)],
    ['Duration', `${durationMinutes(readings)} minutes`],
    ['Readings', readings.length],
    [],
    ['Key Metrics'],
    ['Avg Download (Mbps)', round(m.avgDownload)],
    ['Min Download (Mbps)', round(m.minDownload)],
    ['Max Download (Mbps)', round(m.maxDownload)],
    ['Avg Upload (Mbps)', round(m.avgUpload)],
    ['Avg Latency (ms)', round(m.avgLatency)],
    ['Max Latency (ms)', round(m.maxLatency)],
    ['Avg Jitter (ms)', round(m.avgJitter)],
    ['Avg Stability (%)', round(m.avgStability)],
    ['Per-Device Bandwidth (Mbps)', round(m.perDeviceBandwidth)],
    [],
    ['Recommendations'],
    ['Severity', 'Title', 'Details'],
  ];

  for (const rec of recommendations) {
    rows.push([severityLabel(rec.severity), rec.title, rec.message]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 28 }, { wch: 30 }, { wch: 60 }];
  return ws;
}

function buildStoreOwnerSheet(
  sessionScore: SessionScore,
  recommendations: Recommendation[],
  config: SessionConfig,
): XLSX.WorkSheet {
  const verdict = storeVerdict(sessionScore.overall, config.playerCount);
  const m = sessionScore.metrics;

  const rows: (string | number | null)[][] = [
    ['Store Owner Summary'],
    [],
    ['VERDICT', verdict],
    [],
    ['Key Findings'],
    [`Average download speed: ${round(m.avgDownload)} Mbps`],
    [`Average latency: ${round(m.avgLatency)} ms`],
    [`Connection stability: ${round(m.avgStability)}%`],
    [],
    ['Recommendations (prioritized)'],
  ];

  for (const rec of recommendations) {
    rows.push([`[${severityLabel(rec.severity).toUpperCase()}] ${rec.title}: ${rec.message}`]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 90 }];
  return ws;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateXLSXReport(
  config: SessionConfig,
  readings: MeasurementReading[],
  events: EventTag[],
  sessionScore: SessionScore,
  recommendations: Recommendation[],
): Blob {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, buildSessionInfoSheet(config, readings), 'Session Info');
  XLSX.utils.book_append_sheet(wb, buildMeasurementsSheet(readings), 'Measurements');
  XLSX.utils.book_append_sheet(wb, buildEventLogSheet(events), 'Event Log');
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(sessionScore, recommendations, readings), 'Summary & Findings');
  XLSX.utils.book_append_sheet(wb, buildStoreOwnerSheet(sessionScore, recommendations, config), 'Store Owner Summary');

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function generateCSV(
  _config: SessionConfig,
  readings: MeasurementReading[],
  events: EventTag[],
): Blob {
  const wb = XLSX.utils.book_new();

  // Measurements sheet as CSV
  const measData = readings.map((r) => ({
    Time: new Date(r.timestamp).toISOString(),
    'Elapsed (min)': elapsedMin(r.elapsedMs),
    'Download (Mbps)': round(r.download),
    'Upload (Mbps)': round(r.upload),
    'Latency (ms)': round(r.latency),
    'Jitter (ms)': round(r.jitter),
    'Stability (%)': round(r.stability),
    Status: statusLabel(scoreReading(r).overall),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(measData), 'data');

  // Append events as extra rows after a blank row separator
  if (events.length > 0) {
    const evtData = events.map((e) => ({
      Time: new Date(e.timestamp).toISOString(),
      'Elapsed (min)': elapsedMin(e.elapsedMs),
      'Event Type': e.type,
      Label: e.label,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(evtData), 'events');
  }

  const csv = XLSX.write(wb, { bookType: 'csv', type: 'string', sheet: 'data' }) as string;
  return new Blob([csv], { type: 'text/csv;charset=utf-8' });
}

export function generateBenchmarkJSON(
  config: SessionConfig,
  readings: MeasurementReading[],
  events: EventTag[],
  sessionScore: SessionScore,
  recommendations: Recommendation[],
  calibration: CalibrationResult,
): Blob {
  const exportData: BenchmarkExport = {
    schema_version: '2.0',
    submitted_at: new Date().toISOString(),
    session: {
      id: config.id,
      mode: config.mode,
      date: new Date(config.startTime).toISOString(),
      duration_minutes: durationMinutes(readings),
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
        avg_download: sessionScore.metrics.avgDownload,
        min_download: sessionScore.metrics.minDownload,
        max_download: sessionScore.metrics.maxDownload,
        avg_upload: sessionScore.metrics.avgUpload,
        avg_latency: sessionScore.metrics.avgLatency,
        max_latency: sessionScore.metrics.maxLatency,
        avg_jitter: sessionScore.metrics.avgJitter,
        avg_stability: sessionScore.metrics.avgStability,
        per_device_bandwidth: sessionScore.metrics.perDeviceBandwidth,
      },
      readings: readings.map((r) => ({
        timestamp: new Date(r.timestamp).toISOString(),
        elapsed_minutes: elapsedMin(r.elapsedMs),
        download: r.download,
        upload: r.upload,
        latency: r.latency,
        jitter: r.jitter,
        stability: r.stability,
      })),
    },
    events: events.map((e) => ({
      timestamp: new Date(e.timestamp).toISOString(),
      elapsed_minutes: elapsedMin(e.elapsedMs),
      type: e.type,
    })),
    calibration: {
      browser_p50: calibration.p50,
      browser_p95: calibration.p95,
      browser_iqr: calibration.iqr,
      variance_reliable: calibration.varianceReliable,
    },
    scoring: {
      overall: sessionScore.overall,
      per_device_bandwidth: sessionScore.metrics.perDeviceBandwidth,
      recommendations: recommendations.map((r) => ({
        severity: r.severity,
        trigger: r.trigger,
        message: r.message,
      })),
    },
  };

  const json = JSON.stringify(exportData, null, 2);
  return new Blob([json], { type: 'application/json' });
}
