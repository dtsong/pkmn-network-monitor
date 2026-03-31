import type {
  MeasurementReading,
  ReadingScore,
  ScoreLevel,
  SessionScore,
  PassiveScan,
  PassiveScanScore,
  EventTag,
  EventCorrelation,
} from '../types/index.ts';

// Active measurement thresholds
export const THRESHOLDS = {
  download: { good: 30, fair: 10 }, // Mbps: >= 30 good, 10-30 fair, < 10 poor
  upload: { good: 5, fair: 2 }, // Mbps
  latency: { good: 50, fair: 100 }, // ms: < 50 good, 50-100 fair, > 100 poor (inverted)
  jitter: { good: 15, fair: 30 }, // ms: < 15 good, 15-30 fair, > 30 poor (inverted)
  stability: { good: 98, fair: 95 }, // %: >= 98 good, 95-98 fair, < 95 poor
} as const;

// Passive scan thresholds
export const PASSIVE_THRESHOLDS = {
  rssi: { good: -50, fair: -67 }, // dBm: > -50 good, -50 to -67 fair, < -67 poor
  sameChannel: { good: 1, fair: 4 }, // count: 0-1 good, 2-4 fair, 5+ poor
  totalNetworks: { good: 6, fair: 15 }, // count: < 6 good, 6-15 fair, 16+ poor
} as const;

// Correlation window: max time delta between event and reading (ms)
const CORRELATION_WINDOW_MS = 2 * 60 * 1000;

/**
 * Returns the worst of the given score levels.
 * Ordering: good < fair < poor
 */
export function getWorstScore(...scores: ScoreLevel[]): ScoreLevel {
  if (scores.includes('poor')) return 'poor';
  if (scores.includes('fair')) return 'fair';
  return 'good';
}

/**
 * Score a metric where higher values are better (download, upload, stability).
 */
function scoreHigherIsBetter(
  value: number,
  thresholds: { good: number; fair: number },
): ScoreLevel {
  if (value >= thresholds.good) return 'good';
  if (value >= thresholds.fair) return 'fair';
  return 'poor';
}

/**
 * Score a metric where lower values are better (latency, jitter).
 */
function scoreLowerIsBetter(
  value: number,
  thresholds: { good: number; fair: number },
): ScoreLevel {
  if (value < thresholds.good) return 'good';
  if (value <= thresholds.fair) return 'fair';
  return 'poor';
}

/**
 * Score each metric of a single measurement reading independently.
 * Overall = worst individual score.
 */
export function scoreReading(reading: MeasurementReading): ReadingScore {
  const download = scoreHigherIsBetter(reading.download, THRESHOLDS.download);
  const upload = scoreHigherIsBetter(reading.upload, THRESHOLDS.upload);
  const latency = scoreLowerIsBetter(reading.latency, THRESHOLDS.latency);
  const jitter = scoreLowerIsBetter(reading.jitter, THRESHOLDS.jitter);
  const stability = scoreHigherIsBetter(reading.stability, THRESHOLDS.stability);
  const overall = getWorstScore(download, upload, latency, jitter, stability);

  return { download, upload, latency, jitter, stability, overall };
}

/**
 * Score a passive WiFi scan. Returns null for metrics where scan data is null.
 */
export function scorePassiveScan(scan: PassiveScan): PassiveScanScore {
  const rssi =
    scan.rssiDbm !== null
      ? scoreHigherIsBetter(scan.rssiDbm, PASSIVE_THRESHOLDS.rssi)
      : null;

  const sameChannel =
    scan.sameChannelNetworks !== null
      ? scoreLowerIsBetter(scan.sameChannelNetworks, PASSIVE_THRESHOLDS.sameChannel)
      : null;

  const totalNetworks =
    scan.totalVisibleNetworks !== null
      ? scoreLowerIsBetter(scan.totalVisibleNetworks, PASSIVE_THRESHOLDS.totalNetworks)
      : null;

  return { rssi, sameChannel, totalNetworks };
}

/**
 * Compute P50 (median) of a numeric array. Returns 0 for empty arrays.
 */
function computeP50(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Compute aggregate session score across all readings.
 */
export function computeSessionScore(
  readings: MeasurementReading[],
  events: EventTag[],
  playerCount: number,
  passiveScan: PassiveScan | null,
): SessionScore {
  const downloads = readings.map((r) => r.download);
  const uploads = readings.map((r) => r.upload);
  const latencies = readings.map((r) => r.latency);
  const jitters = readings.map((r) => r.jitter);
  const stabilities = readings.map((r) => r.stability);

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const avg = (arr: number[]) => (arr.length ? sum(arr) / arr.length : 0);

  const avgDownload = avg(downloads);
  const minDownload = downloads.length ? Math.min(...downloads) : 0;
  const maxDownload = downloads.length ? Math.max(...downloads) : 0;
  const avgUpload = avg(uploads);
  const avgLatency = computeP50(latencies); // P50 for latency, never arithmetic mean
  const maxLatency = latencies.length ? Math.max(...latencies) : 0;
  const avgJitter = avg(jitters);
  const avgStability = avg(stabilities);
  const perDeviceBandwidth = playerCount > 0 ? avgDownload / playerCount : 0;

  const metrics = {
    avgDownload,
    minDownload,
    maxDownload,
    avgUpload,
    avgLatency,
    maxLatency,
    avgJitter,
    avgStability,
    perDeviceBandwidth,
  };

  // Score each reading individually
  const readingScores = readings.map(scoreReading);

  // Compute event correlations
  const eventCorrelations: EventCorrelation[] = [];
  for (const event of events) {
    let closestReading: MeasurementReading | null = null;
    let closestDelta = Infinity;

    for (const reading of readings) {
      const delta = Math.abs(event.timestamp - reading.timestamp);
      if (delta < closestDelta) {
        closestDelta = delta;
        closestReading = reading;
      }
    }

    if (closestReading && closestDelta <= CORRELATION_WINDOW_MS) {
      eventCorrelations.push({
        eventId: event.id,
        readingId: closestReading.id,
        eventType: event.type,
        timeDeltaMs: closestDelta,
      });
    }
  }

  // Passive scan scoring
  const passiveScanScore = passiveScan ? scorePassiveScan(passiveScan) : null;

  // Overall session score = worst aggregate metric score
  const aggregateScores: ScoreLevel[] = [
    scoreHigherIsBetter(avgDownload, THRESHOLDS.download),
    scoreHigherIsBetter(avgUpload, THRESHOLDS.upload),
    scoreLowerIsBetter(avgLatency, THRESHOLDS.latency),
    scoreLowerIsBetter(avgJitter, THRESHOLDS.jitter),
    scoreHigherIsBetter(avgStability, THRESHOLDS.stability),
  ];
  const overall = getWorstScore(...aggregateScores);

  return {
    overall,
    metrics,
    readingScores,
    passiveScanScore,
    eventCorrelations,
  };
}
