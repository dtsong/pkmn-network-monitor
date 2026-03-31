import { useState } from 'react';
import type { SessionConfig } from './types';
import Setup from './screens/Setup';

type Screen = 'setup' | 'monitor' | 'loadtest' | 'results';

function App() {
  const [screen, setScreen] = useState<Screen>('setup');
  const [, setSessionConfig] = useState<SessionConfig | null>(null);

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
      {screen === 'monitor' && <div className="p-6 text-center">Monitor screen (coming soon)</div>}
      {screen === 'loadtest' && <div className="p-6 text-center">Load Test screen (coming soon)</div>}
      {screen === 'results' && <div className="p-6 text-center">Results screen (coming soon)</div>}
    </div>
  );
}

export default App;
