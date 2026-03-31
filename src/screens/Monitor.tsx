import { useState, useEffect, useRef, useCallback } from 'react';
import type { SessionConfig, MeasurementReading, EventTag, EventTagType, CalibrationResult, WorkerOutbound, ScoreLevel } from '../types';

interface MonitorScreenProps {
  config: SessionConfig;
  onStop: (readings: MeasurementReading[], events: EventTag[]) => void;
}

const EVENT_TAG_BUTTONS: { type: EventTagType; label: string; icon: string }[] = [
  { type: 'round_start', label: 'Round Started', icon: '▶' },
  { type: 'round_end', label: 'Round Ended', icon: '⏹' },
  { type: 'lag_reported', label: 'Lag Reported', icon: '⚠' },
  { type: 'disconnect', label: 'Disconnect', icon: '✕' },
  { type: 'wifi_changed', label: 'WiFi Changed', icon: '↻' },
  { type: 'break', label: 'Break/Pause', icon: '⏸' },
];

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

function statusBg(level: ScoreLevel): string {
  switch (level) {
    case 'good': return 'bg-green-400/15 text-green-400 border-green-400/30';
    case 'fair': return 'bg-amber-400/15 text-amber-400 border-amber-400/30';
    case 'poor': return 'bg-red-400/15 text-red-400 border-red-400/30';
  }
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatElapsedShort(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function Monitor({ config, onStop }: MonitorScreenProps) {
  const [readings, setReadings] = useState<MeasurementReading[]>([]);
  const [events, setEvents] = useState<EventTag[]>([]);
  const [isCalibrating, setIsCalibrating] = useState(true);
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [startTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [, setCalibrationResult] = useState<CalibrationResult | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const readingsRef = useRef<MeasurementReading[]>([]);
  const eventsRef = useRef<EventTag[]>([]);

  // Keep refs in sync
  useEffect(() => { readingsRef.current = readings; }, [readings]);
  useEffect(() => { eventsRef.current = events; }, [events]);

  // Elapsed timer
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - startTime), 1000);
    return () => clearInterval(id);
  }, [startTime]);

  // Worker lifecycle
  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/measurement.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<WorkerOutbound>) => {
      const msg = e.data;
      switch (msg.type) {
        case 'CALIBRATION_COMPLETE':
          setCalibrationResult(msg.result);
          setIsCalibrating(false);
          setIsMeasuring(true); // First reading starts immediately after calibration
          break;
        case 'READING_COMPLETE':
          setReadings((prev) => [...prev, msg.reading]);
          setIsMeasuring(false);
          break;
        case 'ERROR':
          console.error(`[Worker] ${msg.code}: ${msg.message}`);
          setIsMeasuring(false);
          break;
      }
    };

    worker.postMessage({
      type: 'START_SESSION',
      config,
      targetUrl: config.targetUrl,
    });

    return () => {
      worker.postMessage({ type: 'STOP' });
      worker.terminate();
    };
  }, [config]);

  const handleTakeReading = useCallback(() => {
    if (isMeasuring || isCalibrating) return;
    setIsMeasuring(true);
    workerRef.current?.postMessage({ type: 'TAKE_READING' });
  }, [isMeasuring, isCalibrating]);

  const handleAddEvent = useCallback((type: EventTagType, label: string) => {
    const tag: EventTag = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      elapsedMs: Date.now() - startTime,
      type,
      label,
    };
    setEvents((prev) => [...prev, tag]);
  }, [startTime]);

  const handleStop = useCallback(() => {
    workerRef.current?.postMessage({ type: 'STOP' });
    workerRef.current?.terminate();
    onStop(readingsRef.current, eventsRef.current);
  }, [onStop]);

  const latestReading = readings.length > 0 ? readings[readings.length - 1] : null;
  const latestStatus = latestReading ? getStatusLevel(latestReading) : null;

  const avgDownload = readings.length > 0
    ? readings.reduce((s, r) => s + r.download, 0) / readings.length
    : 0;
  const avgLatency = readings.length > 0
    ? readings.reduce((s, r) => s + r.latency, 0) / readings.length
    : 0;

  return (
    <div className="min-h-screen pb-6">
      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">

        {/* Top Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
            </span>
            <span className="text-red-400 font-medium text-sm">Recording</span>
          </div>
          <span className="text-gray-300 font-mono text-lg">{formatElapsed(elapsed)}</span>
          <button
            type="button"
            onClick={() => setShowStopConfirm(true)}
            className="min-h-12 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm transition-colors cursor-pointer"
          >
            Stop
          </button>
        </div>

        {/* Calibration State */}
        {isCalibrating && (
          <div className="bg-[#16213e] rounded-xl p-6 text-center">
            <div className="animate-spin h-8 w-8 border-2 border-[#4361ee] border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-gray-300 font-medium">Calibrating...</p>
            <p className="text-gray-500 text-sm mt-1">Measuring browser overhead for accurate readings</p>
          </div>
        )}

        {/* Current Status Card */}
        {!isCalibrating && latestReading && latestStatus && (
          <div className="bg-[#16213e] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-white">Current Status</h2>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${statusBg(latestStatus)}`}>
                {latestStatus === 'good' ? 'Good' : latestStatus === 'fair' ? 'Fair' : 'Poor'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-gray-400 text-xs">Download</p>
                <p className={`text-2xl font-bold ${statusColor(latestStatus)}`}>
                  {latestReading.download.toFixed(1)} <span className="text-sm font-normal">Mbps</span>
                </p>
              </div>
              <div>
                <p className="text-gray-400 text-xs">Latency</p>
                <p className={`text-2xl font-bold ${statusColor(latestStatus)}`}>
                  {latestReading.latency.toFixed(0)} <span className="text-sm font-normal">ms</span>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* No readings yet (post-calibration) */}
        {!isCalibrating && !latestReading && (
          <div className="bg-[#16213e] rounded-xl p-5 text-center">
            <p className="text-gray-400">Taking first reading...</p>
          </div>
        )}

        {/* Running Stats */}
        {!isCalibrating && readings.length > 0 && (
          <div className="bg-[#16213e] rounded-xl p-5">
            <h2 className="text-lg font-semibold text-white mb-3">Running Stats</h2>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-gray-400 text-xs">Readings</p>
                <p className="text-xl font-bold text-white">{readings.length}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs">Avg Download</p>
                <p className="text-xl font-bold text-white">{avgDownload.toFixed(1)}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs">Avg Latency</p>
                <p className="text-xl font-bold text-white">{avgLatency.toFixed(0)} ms</p>
              </div>
            </div>
          </div>
        )}

        {/* Take Reading Now */}
        {!isCalibrating && (
          <button
            type="button"
            onClick={handleTakeReading}
            disabled={isMeasuring}
            className={`w-full min-h-12 rounded-xl font-semibold text-sm transition-colors cursor-pointer ${
              isMeasuring
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-[#4361ee] hover:bg-[#3a56d4] text-white'
            }`}
          >
            {isMeasuring ? 'Measuring...' : 'Take Reading Now'}
          </button>
        )}

        {/* Event Tag Grid */}
        {!isCalibrating && (
          <div className="bg-[#16213e] rounded-xl p-5">
            <h2 className="text-lg font-semibold text-white mb-3">Event Tags</h2>
            <div className="grid grid-cols-3 gap-2">
              {EVENT_TAG_BUTTONS.map((btn) => (
                <button
                  key={btn.type}
                  type="button"
                  onClick={() => handleAddEvent(btn.type, btn.label)}
                  className="min-h-12 px-2 py-3 rounded-xl bg-[#0f1a30] border border-gray-600 hover:border-[#4361ee] hover:bg-[#4361ee]/10 text-white text-xs font-medium transition-colors cursor-pointer flex flex-col items-center gap-1"
                >
                  <span className="text-lg">{btn.icon}</span>
                  <span>{btn.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Event Log Feed */}
        {events.length > 0 && (
          <div className="bg-[#16213e] rounded-xl p-5">
            <h2 className="text-lg font-semibold text-white mb-3">Event Log</h2>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {[...events].reverse().slice(0, 8).map((evt) => {
                const btn = EVENT_TAG_BUTTONS.find((b) => b.type === evt.type);
                return (
                  <div key={evt.id} className="flex items-center gap-3 text-sm py-1 border-b border-gray-700/50 last:border-0">
                    <span className="text-gray-500 font-mono text-xs w-12 shrink-0">{formatElapsedShort(evt.elapsedMs)}</span>
                    <span className="text-base">{btn?.icon}</span>
                    <span className="text-gray-300">{evt.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Measurement Feed */}
        {readings.length > 0 && (
          <div className="bg-[#16213e] rounded-xl p-5">
            <h2 className="text-lg font-semibold text-white mb-3">Measurement Feed</h2>
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
      </div>

      {/* Stop Confirmation Dialog */}
      {showStopConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="bg-[#16213e] rounded-xl p-6 max-w-sm w-full space-y-4">
            <h3 className="text-lg font-semibold text-white">Stop Recording?</h3>
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
