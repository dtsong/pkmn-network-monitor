/// <reference lib="webworker" />

// ============================================================
// Measurement Web Worker
// ============================================================
// Runs calibration + measurement loop off the main thread.
// Communicates via structured messages matching WorkerInbound /
// WorkerOutbound contracts from src/types/index.ts.
//
// Types are duplicated inline because Web Workers operate in a
// separate module scope and cannot reliably import from src/.
// ============================================================

// --- Inline type shapes (mirrors src/types/index.ts) ---

interface CalibrationResult {
  p50: number;
  p95: number;
  iqr: number;
  varianceReliable: boolean;
  samples: number;
}

interface MeasurementReading {
  id: string;
  timestamp: number;
  elapsedMs: number;
  download: number;
  upload: number;
  latency: number;
  jitter: number;
  stability: number;
  raw: {
    latencyP50: number;
    latencyP95: number;
    jitterIQR: number;
    latencySamples: number[];
  };
}

type SessionMode = 'event_monitor' | 'load_test';

interface WorkerConfig {
  mode: SessionMode;
  targetUrl: string;
}

type InboundMessage =
  | { type: 'START_SESSION'; config: { mode: SessionMode; targetUrl: string }; targetUrl: string }
  | { type: 'TAKE_READING' }
  | { type: 'STOP' };

type OutboundMessage =
  | { type: 'CALIBRATION_COMPLETE'; result: CalibrationResult }
  | { type: 'READING_COMPLETE'; reading: MeasurementReading }
  | { type: 'ERROR'; code: string; message: string };

// --- Constants ---

const INTERVALS: Record<SessionMode, number> = {
  event_monitor: 120_000, // 2 minutes
  load_test: 15_000, // 15 seconds
};

const LOAD_TEST_DURATION = 300_000; // 5 minutes auto-stop
const THROTTLE_FACTOR = 3; // gap > 3x interval = throttled

// Calibration constants
const CALIBRATION_PINGS = 50;
const WARMUP_DISCARD = 5;
const PING_INTERVAL_MS = 100;

// --- State ---

let config: WorkerConfig | null = null;
let calibration: CalibrationResult | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
let sessionStartTime = 0;
let lastReadingTime = 0;
let readingInProgress = false;

// --- Helpers ---

function post(msg: OutboundMessage): void {
  self.postMessage(msg);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function correctLatency(observed: number, browserP50: number): number {
  return Math.max(0, observed - browserP50);
}

function correctJitter(observedIQR: number, browserIQR: number): number {
  return Math.sqrt(Math.max(0, observedIQR ** 2 - browserIQR ** 2));
}

// --- Calibration ---

async function runCalibration(): Promise<CalibrationResult> {
  const samples: number[] = [];

  for (let i = 0; i < CALIBRATION_PINGS; i++) {
    const start = performance.now();
    try {
      await fetch('/ping-calibration', { cache: 'no-store' });
    } catch {
      // Still measures browser fetch overhead even on failure
    }
    const elapsed = performance.now() - start;
    samples.push(elapsed);

    if (i < CALIBRATION_PINGS - 1) {
      await new Promise((r) => setTimeout(r, PING_INTERVAL_MS));
    }
  }

  const usable = samples.slice(WARMUP_DISCARD);
  usable.sort((a, b) => a - b);

  const p50 = percentile(usable, 50);
  const p95 = percentile(usable, 95);
  const iqr = percentile(usable, 75) - percentile(usable, 25);
  const varianceReliable = p95 <= 20 && iqr <= 15;

  return { p50, p95, iqr, varianceReliable, samples: usable.length };
}

// --- Measurement functions ---

async function measureDownload(targetUrl: string): Promise<number> {
  const bytes = 1_000_000; // 1 MB
  const start = performance.now();
  const response = await fetch(`${targetUrl}/down?bytes=${bytes}`, {
    cache: 'no-store',
  });
  await response.arrayBuffer(); // Must consume the body
  const elapsed = (performance.now() - start) / 1000; // seconds
  return (bytes * 8) / elapsed / 1_000_000; // Mbps
}

async function measureUpload(targetUrl: string): Promise<number> {
  const bytes = 500_000; // 500 KB
  const data = new Uint8Array(bytes);
  const start = performance.now();
  await fetch(`${targetUrl}/up`, {
    method: 'POST',
    body: data,
    cache: 'no-store',
  });
  const elapsed = (performance.now() - start) / 1000;
  return (bytes * 8) / elapsed / 1_000_000; // Mbps
}

async function measureLatency(
  targetUrl: string,
): Promise<{ samples: number[]; successRate: number }> {
  const samples: number[] = [];
  let successes = 0;
  const PING_COUNT = 5;

  for (let i = 0; i < PING_COUNT; i++) {
    try {
      const start = performance.now();
      await fetch(`${targetUrl}/ping`, { cache: 'no-store' });
      samples.push(performance.now() - start);
      successes++;
    } catch {
      // Count as failure for stability
    }
  }

  return { samples, successRate: (successes / PING_COUNT) * 100 };
}

// --- Full measurement cycle ---

async function takeReading(): Promise<void> {
  if (!config || !calibration) return;
  if (readingInProgress) return;

  readingInProgress = true;
  const now = performance.now();

  // Throttle detection
  if (lastReadingTime > 0) {
    const gap = now - lastReadingTime;
    const expectedInterval = INTERVALS[config.mode];
    if (gap > expectedInterval * THROTTLE_FACTOR) {
      post({
        type: 'ERROR',
        code: 'BACKGROUND_THROTTLE',
        message: `Reading gap ${Math.round(gap)}ms exceeds ${THROTTLE_FACTOR}x expected interval (${expectedInterval}ms). Browser may be throttling background tab.`,
      });
    }
  }

  lastReadingTime = now;

  try {
    const download = await measureDownload(config.targetUrl);
    const upload = await measureUpload(config.targetUrl);
    const { samples: latencySamples, successRate } = await measureLatency(
      config.targetUrl,
    );

    // Compute raw stats from latency samples
    const sortedSamples = [...latencySamples].sort((a, b) => a - b);
    const rawP50 = percentile(sortedSamples, 50);
    const rawP95 = percentile(sortedSamples, 95);
    const rawIQR =
      percentile(sortedSamples, 75) - percentile(sortedSamples, 25);

    // Apply noise correction
    const correctedLatency = correctLatency(rawP50, calibration.p50);
    const correctedJitter = calibration.varianceReliable
      ? correctJitter(rawIQR, calibration.iqr)
      : rawIQR; // Use raw jitter if calibration variance is unreliable

    const reading: MeasurementReading = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      elapsedMs: performance.now() - (sessionStartTime || now),
      download,
      upload,
      latency: correctedLatency,
      jitter: correctedJitter,
      stability: successRate,
      raw: {
        latencyP50: rawP50,
        latencyP95: rawP95,
        jitterIQR: rawIQR,
        latencySamples,
      },
    };

    post({ type: 'READING_COMPLETE', reading });
  } catch (err) {
    post({
      type: 'ERROR',
      code: 'READING_FAILED',
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    readingInProgress = false;
  }
}

// --- Session lifecycle ---

function stopSession(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  config = null;
  calibration = null;
  readingInProgress = false;
}

async function startSession(
  sessionConfig: WorkerConfig,
): Promise<void> {
  stopSession(); // Clean up any prior session

  config = sessionConfig;
  sessionStartTime = performance.now();
  lastReadingTime = 0;

  // Run calibration first
  try {
    calibration = await runCalibration();
    post({ type: 'CALIBRATION_COMPLETE', result: calibration });
  } catch (err) {
    post({
      type: 'ERROR',
      code: 'CALIBRATION_FAILED',
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Take first reading immediately
  await takeReading();

  // Start interval loop
  const interval = INTERVALS[config.mode];
  intervalId = setInterval(() => {
    void takeReading();
  }, interval);

  // Load test auto-stop after 5 minutes
  if (config.mode === 'load_test') {
    setTimeout(() => {
      stopSession();
    }, LOAD_TEST_DURATION);
  }
}

// --- Message handler ---

self.onmessage = (event: MessageEvent<InboundMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case 'START_SESSION':
      void startSession({
        mode: msg.config.mode,
        targetUrl: msg.targetUrl,
      });
      break;

    case 'TAKE_READING':
      void takeReading();
      break;

    case 'STOP':
      stopSession();
      break;
  }
};
