import type { MeasurementReading, EventTag, SessionConfig } from '../types/index';

const STORAGE_KEY = 'pkmn_session';

interface StoredSession {
  config: SessionConfig;
  readings: MeasurementReading[];
  events: EventTag[];
  startTime: number;
  lastUpdate: number;
}

export function saveSessionState(
  config: SessionConfig,
  readings: MeasurementReading[],
  events: EventTag[],
  startTime: number,
): void {
  const state: StoredSession = {
    config,
    readings,
    events,
    startTime,
    lastUpdate: Date.now(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable
  }
}

export function getRecoverableSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const state: StoredSession = JSON.parse(raw);
    // Only offer recovery if session is less than 24 hours old
    if (Date.now() - state.lastUpdate > 24 * 60 * 60 * 1000) {
      clearSessionState();
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

export function clearSessionState(): void {
  localStorage.removeItem(STORAGE_KEY);
}
