import { useState } from 'react';
import type { SessionConfig, MeasurementReading, EventTag } from './types';
import Setup from './screens/Setup';
import Monitor from './screens/Monitor';
import LoadTest from './screens/LoadTest';

type Screen = 'setup' | 'monitor' | 'loadtest' | 'results';

function App() {
  const [screen, setScreen] = useState<Screen>('setup');
  const [sessionConfig, setSessionConfig] = useState<SessionConfig | null>(null);
  const [, setReadings] = useState<MeasurementReading[]>([]);
  const [, setEvents] = useState<EventTag[]>([]);

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-white">
      {screen === 'setup' && (
        <Setup
          onStart={(config) => {
            setSessionConfig(config);
            setScreen(config.mode === 'load_test' ? 'loadtest' : 'monitor');
          }}
        />
      )}
      {screen === 'monitor' && sessionConfig && (
        <Monitor
          config={sessionConfig}
          onStop={(readings, events) => {
            setReadings(readings);
            setEvents(events);
            setScreen('results');
          }}
        />
      )}
      {screen === 'loadtest' && sessionConfig && (
        <LoadTest
          config={sessionConfig}
          onStop={(readings, events) => {
            setReadings(readings);
            setEvents(events);
            setScreen('results');
          }}
        />
      )}
      {screen === 'results' && <div className="p-6 text-center">Results screen (coming soon)</div>}
    </div>
  );
}

export default App;
