import type { CalibrationResult } from '../types/index';

const CALIBRATION_PINGS = 50;
const WARMUP_DISCARD = 5;
const PING_INTERVAL_MS = 100;

export async function runCalibration(): Promise<CalibrationResult> {
  const samples: number[] = [];

  for (let i = 0; i < CALIBRATION_PINGS; i++) {
    const start = performance.now();
    // Ping a data URL or the current origin to measure browser timing overhead
    try {
      await fetch('/ping-calibration', { cache: 'no-store' });
    } catch {
      // If no endpoint available, use a self-referencing fetch
      // This still measures the browser's fetch overhead
    }
    const elapsed = performance.now() - start;
    samples.push(elapsed);

    if (i < CALIBRATION_PINGS - 1) {
      await new Promise((r) => setTimeout(r, PING_INTERVAL_MS));
    }
  }

  // Discard first N (JIT warmup)
  const usable = samples.slice(WARMUP_DISCARD);
  usable.sort((a, b) => a - b);

  const p50 = percentile(usable, 50);
  const p95 = percentile(usable, 95);
  const iqr = percentile(usable, 75) - percentile(usable, 25);

  // Kill switch: if browser noise is too high, mark jitter as unreliable
  const varianceReliable = p95 <= 20 && iqr <= 15;

  return { p50, p95, iqr, varianceReliable, samples: usable.length };
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

// Noise correction formulas from council research
export function correctLatency(observed: number, browserP50: number): number {
  return Math.max(0, observed - browserP50);
}

export function correctJitter(observedIQR: number, browserIQR: number): number {
  return Math.sqrt(Math.max(0, observedIQR ** 2 - browserIQR ** 2));
}
