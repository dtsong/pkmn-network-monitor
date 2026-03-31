// === Measurement Types ===

export interface MeasurementReading {
  id: string;
  timestamp: number; // Unix ms
  elapsedMs: number; // ms since session start
  download: number; // Mbps
  upload: number; // Mbps
  latency: number; // ms (P50 corrected)
  jitter: number; // ms (IQR corrected)
  stability: number; // % (0-100)
  raw: {
    latencyP50: number;
    latencyP95: number;
    jitterIQR: number;
    latencySamples: number[];
  };
}

export type EventTagType =
  | 'round_start'
  | 'round_end'
  | 'lag_reported'
  | 'disconnect'
  | 'wifi_changed'
  | 'break';

export interface EventTag {
  id: string;
  timestamp: number;
  elapsedMs: number;
  type: EventTagType;
  label: string;
}

export interface CalibrationResult {
  p50: number;
  p95: number;
  iqr: number;
  varianceReliable: boolean; // false if P95 > 20ms or IQR > 15ms
  samples: number;
}

// === Session Types ===

export type GameType = 'champions_switch' | 'champions_mobile' | 'pokemon_go' | 'tcg';
export type DeviceType = 'switch' | 'switch_oled' | 'switch_lite' | 'switch_2' | 'iphone' | 'android' | 'tablet';
export type ConnectionType = 'fiber' | 'cable' | 'dsl' | 'cellular' | 'satellite' | 'unknown';
export type SessionMode = 'event_monitor' | 'load_test';
export type WiFiBand = '2.4ghz' | '5ghz' | '6ghz' | 'both' | 'unknown';

export interface PassiveScan {
  rssiDbm: number | null;
  band: WiFiBand;
  sameChannelNetworks: number | null;
  totalVisibleNetworks: number | null;
}

export interface SessionConfig {
  id: string;
  mode: SessionMode;
  startTime: number;
  games: GameType[];
  devices: DeviceType[];
  playerCount: number;
  venue: {
    name: string;
    city: string;
    country: string;
  };
  network: {
    isp: string;
    connectionType: ConnectionType;
    routerModel: string;
    accessPoints: number | null; // 1, 2, 3+ or null
  };
  passiveScan: PassiveScan | null;
  targetUrl: string; // Cloudflare Worker URL
}

// === Scoring Types ===

export type ScoreLevel = 'good' | 'fair' | 'poor';

export interface ReadingScore {
  download: ScoreLevel;
  upload: ScoreLevel;
  latency: ScoreLevel;
  jitter: ScoreLevel;
  stability: ScoreLevel;
  overall: ScoreLevel;
}

export interface PassiveScanScore {
  rssi: ScoreLevel | null;
  sameChannel: ScoreLevel | null;
  totalNetworks: ScoreLevel | null;
}

export interface SessionScore {
  overall: ScoreLevel;
  metrics: {
    avgDownload: number;
    minDownload: number;
    maxDownload: number;
    avgUpload: number;
    avgLatency: number;
    maxLatency: number;
    avgJitter: number;
    avgStability: number;
    perDeviceBandwidth: number;
  };
  readingScores: ReadingScore[];
  passiveScanScore: PassiveScanScore | null;
  eventCorrelations: EventCorrelation[];
}

export interface EventCorrelation {
  eventId: string;
  readingId: string;
  eventType: EventTagType;
  timeDeltaMs: number;
}

// === Recommendation Types ===

export type Severity = 'high' | 'medium' | 'informational';

export interface Recommendation {
  id: string;
  severity: Severity;
  trigger: string; // machine-readable trigger condition
  title: string;
  message: string; // human-readable with interpolated data
}

// === Export Types ===

export interface BenchmarkExport {
  schema_version: '2.0';
  submitted_at: string; // ISO 8601
  session: {
    id: string;
    mode: SessionMode;
    date: string; // ISO 8601
    duration_minutes: number;
    readings_count: number;
  };
  event: {
    games: GameType[];
    devices: DeviceType[];
    player_count: number;
  };
  venue: {
    name: string;
    city: string;
    country: string;
  };
  network: {
    isp: string;
    connection_type: ConnectionType;
    router_model: string;
    access_points: number | null;
  };
  passive_scan: {
    rssi_dbm: number | null;
    band: WiFiBand;
    same_channel_networks: number | null;
    total_visible_networks: number | null;
  } | null;
  measurements: {
    summary: {
      avg_download: number;
      min_download: number;
      max_download: number;
      avg_upload: number;
      avg_latency: number;
      max_latency: number;
      avg_jitter: number;
      avg_stability: number;
      per_device_bandwidth: number;
    };
    readings: Array<{
      timestamp: string;
      elapsed_minutes: number;
      download: number;
      upload: number;
      latency: number;
      jitter: number;
      stability: number;
    }>;
  };
  events: Array<{
    timestamp: string;
    elapsed_minutes: number;
    type: EventTagType;
  }>;
  calibration: {
    browser_p50: number;
    browser_p95: number;
    browser_iqr: number;
    variance_reliable: boolean;
  };
  scoring: {
    overall: ScoreLevel;
    per_device_bandwidth: number;
    recommendations: Array<{
      severity: Severity;
      trigger: string;
      message: string;
    }>;
  };
}

// === Worker Message Types ===

export type WorkerInbound =
  | { type: 'START_SESSION'; config: SessionConfig; targetUrl: string }
  | { type: 'TAKE_READING' }
  | { type: 'STOP' };

export type WorkerOutbound =
  | { type: 'CALIBRATION_COMPLETE'; result: CalibrationResult }
  | { type: 'READING_COMPLETE'; reading: MeasurementReading }
  | { type: 'ERROR'; code: string; message: string };
