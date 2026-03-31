import { useState } from 'react';
import type { SessionConfig, MeasurementReading, EventTag } from './types';
import Setup from './screens/Setup';
import Monitor from './screens/Monitor';
import LoadTest from './screens/LoadTest';
import Results from './screens/Results';

type Screen = 'setup' | 'monitor' | 'loadtest' | 'results';

function App() {
  const [screen, setScreen] = useState<Screen>('setup');
  const [sessionConfig, setSessionConfig] = useState<SessionConfig | null>(null);
  const [readings, setReadings] = useState<MeasurementReading[]>([]);
  const [events, setEvents] = useState<EventTag[]>([]);

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
      {screen === 'results' && sessionConfig && (
        <Results
          config={sessionConfig}
          readings={readings}
          events={events}
          onNewSession={() => {
            setScreen('setup');
            setSessionConfig(null);
            setReadings([]);
            setEvents([]);
          }}
        />
      )}
    </div>
  );
}

export default App;
