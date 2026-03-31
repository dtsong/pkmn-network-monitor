import { useState, useEffect, useRef, useCallback } from 'react';
import type { SessionConfig, MeasurementReading, EventTag, EventTagType, WorkerOutbound, ScoreLevel } from '../types';

interface LoadTestScreenProps {
  config: SessionConfig;
  onStop: (readings: MeasurementReading[], events: EventTag[]) => void;
}

const LOAD_TEST_DURATION = 300_000; // 5 minutes
const DEVICE_MILESTONES = [5, 10, 15, 20];

function getStatusLevel(reading: MeasurementReading): ScoreLevel {
  if (reading.download < 5 || reading.latency > 100) return 'poor';
  if (reading.download < 15 || reading.latency > 50) return 'fair';
  return 'good';
}

function statusColor(level: ScoreLevel): string {
  switch (level) {
    case 'good': return 'text-green-400';
    case 'fair': return 'text-amber-400';
    case 'poor': return 'text-red-400';
  }
}

function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatElapsedShort(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function LoadTest({ config, onStop }: LoadTestScreenProps) {
  const [phase, setPhase] = useState<'instructions' | 'active'>('instructions');
  const [readings, setReadings] = useState<MeasurementReading[]>([]);
  const [events, setEvents] = useState<EventTag[]>([]);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [startTime, setStartTime] = useState(0);
  const [remaining, setRemaining] = useState(LOAD_TEST_DURATION);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [activeMilestones, setActiveMilestones] = useState<Set<number>>(new Set());
  const workerRef = useRef<Worker | null>(null);
  const readingsRef = useRef<MeasurementReading[]>([]);
  const eventsRef = useRef<EventTag[]>([]);
  const stoppedRef = useRef(false);

  useEffect(() => { readingsRef.current = readings; }, [readings]);
  useEffect(() => { eventsRef.current = events; }, [events]);

  // Countdown timer
  useEffect(() => {
    if (phase !== 'active' || startTime === 0) return;
    const id = setInterval(() => {
      const left = LOAD_TEST_DURATION - (Date.now() - startTime);
      setRemaining(Math.max(0, left));
      if (left <= 0 && !stoppedRef.current) {
        stoppedRef.current = true;
        workerRef.current?.postMessage({ type: 'STOP' });
        workerRef.current?.terminate();
        onStop(readingsRef.current, eventsRef.current);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase, startTime, onStop]);

  const startTest = useCallback(() => {
    setPhase('active');
    setIsCalibrating(true);
    const now = Date.now();
    setStartTime(now);

    const worker = new Worker(
      new URL('../workers/measurement.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<WorkerOutbound>) => {
      const msg = e.data;
      switch (msg.type) {
        case 'CALIBRATION_COMPLETE':
          setIsCalibrating(false);
          break;
        case 'READING_COMPLETE':
          setReadings((prev) => [...prev, msg.reading]);
          break;
        case 'ERROR':
          console.error(`[Worker] ${msg.code}: ${msg.message}`);
          break;
      }
    };

    worker.postMessage({
      type: 'START_SESSION',
      config,
      targetUrl: config.targetUrl,
    });
  }, [config]);

  const handleStop = useCallback(() => {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    workerRef.current?.postMessage({ type: 'STOP' });
    workerRef.current?.terminate();
    onStop(readingsRef.current, eventsRef.current);
  }, [onStop]);

  const handleMilestone = useCallback((count: number) => {
    setActiveMilestones((prev) => {
      const next = new Set(prev);
      next.add(count);
      return next;
    });
    const tag: EventTag = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      elapsedMs: Date.now() - startTime,
      type: 'round_start' as EventTagType,
      label: `${count} devices connected`,
    };
    setEvents((prev) => [...prev, tag]);
  }, [startTime]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.postMessage({ type: 'STOP' });
      workerRef.current?.terminate();
    };
  }, []);

  // Degradation calc
  const firstReading = readings.length > 0 ? readings[0] : null;
  const latestReading = readings.length > 0 ? readings[readings.length - 1] : null;
  const degradation = firstReading && latestReading && readings.length > 1
    ? ((firstReading.download - latestReading.download) / firstReading.download) * 100
    : null;

  const progress = Math.min(100, ((LOAD_TEST_DURATION - remaining) / LOAD_TEST_DURATION) * 100);

  // Instructions phase
  if (phase === 'instructions') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-lg w-full space-y-6 text-center">
          <div className="bg-[#16213e] rounded-xl p-8 space-y-4">
            <div className="text-4xl">📡</div>
            <h1 className="text-2xl font-bold text-white">Load Test</h1>
            <p className="text-gray-300 text-sm leading-relaxed">
              Get everyone connected to the WiFi. The more devices, the more realistic the test.
            </p>
            <p className="text-gray-500 text-xs">
              The test runs for 5 minutes with measurements every 15 seconds.
              Use the device milestone buttons to mark when players connect.
            </p>
          </div>
          <button
            type="button"
            onClick={startTest}
            className="w-full min-h-12 rounded-xl bg-[#4361ee] hover:bg-[#3a56d4] text-white font-semibold text-lg transition-colors cursor-pointer"
          >
            Start Load Test
          </button>
        </div>
      </div>
    );
  }

  // Active phase
  return (
    <div className="min-h-screen pb-6">
      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">

        {/* Countdown + Progress */}
        <div className="bg-[#16213e] rounded-xl p-5 text-center">
          <p className="text-gray-400 text-xs mb-1">Time Remaining</p>
          <p className="text-4xl font-bold font-mono text-white">{formatCountdown(remaining)}</p>
          <div className="mt-3 h-2 bg-[#0f1a30] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#4361ee] rounded-full transition-all duration-1000"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Calibrating */}
        {isCalibrating && (
          <div className="bg-[#16213e] rounded-xl p-6 text-center">
            <div className="animate-spin h-8 w-8 border-2 border-[#4361ee] border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-gray-300 font-medium">Calibrating...</p>
            <p className="text-gray-500 text-sm mt-1">Measuring browser overhead for accurate readings</p>
          </div>
        )}

        {/* Degradation Display */}
        {!isCalibrating && firstReading && latestReading && readings.length > 1 && (
          <div className="bg-[#16213e] rounded-xl p-5">
            <h2 className="text-lg font-semibold text-white mb-2">Speed Degradation</h2>
            <p className={`text-sm ${degradation !== null && degradation > 20 ? 'text-red-400' : degradation !== null && degradation > 10 ? 'text-amber-400' : 'text-green-400'}`}>
              Speed dropped from {firstReading.download.toFixed(1)} to {latestReading.download.toFixed(1)} Mbps
              {degradation !== null && (
                <span className="font-semibold"> ({degradation > 0 ? '-' : '+'}{Math.abs(degradation).toFixed(0)}% reduction)</span>
              )}
            </p>
          </div>
        )}

        {/* Device Milestones */}
        {!isCalibrating && (
          <div className="bg-[#16213e] rounded-xl p-5">
            <h2 className="text-lg font-semibold text-white mb-3">Device Milestones</h2>
            <div className="grid grid-cols-4 gap-2">
              {DEVICE_MILESTONES.map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => handleMilestone(count)}
                  disabled={activeMilestones.has(count)}
                  className={`min-h-12 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                    activeMilestones.has(count)
                      ? 'bg-[#4361ee]/20 text-[#4361ee] border border-[#4361ee]/40 cursor-not-allowed'
                      : 'bg-[#0f1a30] border border-gray-600 hover:border-[#4361ee] text-white'
                  }`}
                >
                  {count} devices
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Measurement Feed */}
        {readings.length > 0 && (
          <div className="bg-[#16213e] rounded-xl p-5">
            <h2 className="text-lg font-semibold text-white mb-3">Measurements</h2>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {[...readings].reverse().slice(0, 10).map((r) => {
                const level = getStatusLevel(r);
                return (
                  <div key={r.id} className="flex items-center justify-between text-sm py-2 border-b border-gray-700/50 last:border-0">
                    <span className="text-gray-500 font-mono text-xs w-12 shrink-0">{formatElapsedShort(r.elapsedMs)}</span>
                    <span className="text-gray-300">{r.download.toFixed(1)} Mbps</span>
                    <span className="text-gray-300">{r.latency.toFixed(0)} ms</span>
                    <span className={`text-xs font-semibold ${statusColor(level)}`}>
                      {level === 'good' ? 'Good' : level === 'fair' ? 'Fair' : 'Poor'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Stop Early */}
        <button
          type="button"
          onClick={() => setShowStopConfirm(true)}
          className="w-full min-h-12 rounded-xl bg-red-600/20 border border-red-600/40 hover:bg-red-600/30 text-red-400 font-semibold text-sm transition-colors cursor-pointer"
        >
          Stop Early
        </button>
      </div>

      {/* Stop Confirmation Dialog */}
      {showStopConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-[#16213e] rounded-xl p-6 max-w-sm w-full space-y-4">
            <h3 className="text-lg font-semibold text-white">Stop Load Test?</h3>
            <p className="text-gray-400 text-sm">
              This will end the session. You can&apos;t resume after stopping.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowStopConfirm(false)}
                className="flex-1 min-h-12 rounded-xl bg-[#0f1a30] border border-gray-600 text-white font-semibold text-sm transition-colors cursor-pointer hover:border-gray-400"
              >
                Keep Going
              </button>
              <button
                type="button"
                onClick={handleStop}
                className="flex-1 min-h-12 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm transition-colors cursor-pointer"
              >
                Stop &amp; View Results
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
