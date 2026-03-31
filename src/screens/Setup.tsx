import { useState, useEffect } from 'react';
import type { SessionConfig, GameType, DeviceType, ConnectionType, WiFiBand, SessionMode } from '../types';

interface SetupScreenProps {
  onStart: (config: SessionConfig) => void;
}

const GAME_OPTIONS: { label: string; value: GameType }[] = [
  { label: 'Champions (Switch)', value: 'champions_switch' },
  { label: 'Champions (Mobile)', value: 'champions_mobile' },
  { label: 'Pokemon Go', value: 'pokemon_go' },
  { label: 'TCG', value: 'tcg' },
];

const DEVICE_OPTIONS: { label: string; value: DeviceType }[] = [
  { label: 'Switch', value: 'switch' },
  { label: 'Switch OLED', value: 'switch_oled' },
  { label: 'Switch Lite', value: 'switch_lite' },
  { label: 'Switch 2', value: 'switch_2' },
  { label: 'iPhone', value: 'iphone' },
  { label: 'Android', value: 'android' },
  { label: 'iPad/Tablet', value: 'tablet' },
];

const PLAYER_PRESETS = [8, 12, 16, 24, 32, 48];

const CONNECTION_OPTIONS: { label: string; value: ConnectionType }[] = [
  { label: 'Fiber', value: 'fiber' },
  { label: 'Cable', value: 'cable' },
  { label: 'DSL', value: 'dsl' },
  { label: 'Cellular', value: 'cellular' },
  { label: 'Satellite', value: 'satellite' },
  { label: "Don't Know", value: 'unknown' },
];

const WIFI_BAND_OPTIONS: { label: string; value: WiFiBand }[] = [
  { label: '2.4 GHz', value: '2.4ghz' },
  { label: '5 GHz', value: '5ghz' },
  { label: '6 GHz', value: '6ghz' },
  { label: 'Both', value: 'both' },
  { label: "Don't Know", value: 'unknown' },
];

const AP_OPTIONS = [
  { label: '1', value: 1 },
  { label: '2', value: 2 },
  { label: '3+', value: 3 },
  { label: 'Not Sure', value: null },
] as const;

const SAME_CHANNEL_OPTIONS = [
  { label: '0', value: '0' },
  { label: '1-2', value: '1-2' },
  { label: '3-5', value: '3-5' },
  { label: '6+', value: '6+' },
  { label: "Don't Know", value: 'unknown' },
];

const TOTAL_NETWORKS_OPTIONS = [
  { label: 'Under 6', value: 'under6' },
  { label: '6-15', value: '6-15' },
  { label: '16+', value: '16+' },
  { label: "Didn't Check", value: 'unknown' },
];

function sameChannelToNumber(val: string): number | null {
  switch (val) {
    case '0': return 0;
    case '1-2': return 2;
    case '3-5': return 5;
    case '6+': return 6;
    default: return null;
  }
}

function totalNetworksToNumber(val: string): number | null {
  switch (val) {
    case 'under6': return 5;
    case '6-15': return 15;
    case '16+': return 16;
    default: return null;
  }
}

function Chip({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`min-h-12 min-w-12 px-4 py-2 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
        selected
          ? 'bg-[#4361ee] text-white border border-[#4361ee]'
          : 'bg-transparent text-gray-300 border border-gray-600 hover:border-gray-400'
      }`}
    >
      {label}
    </button>
  );
}

function SectionCard({
  title,
  children,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-[#16213e] rounded-xl p-5">
      <button
        type="button"
        className={`w-full flex items-center justify-between text-left ${collapsible ? 'cursor-pointer' : 'cursor-default'}`}
        onClick={() => collapsible && setOpen(!open)}
      >
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {collapsible && (
          <span className="text-gray-400 text-xl transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>
            ▾
          </span>
        )}
      </button>
      {open && <div className="mt-4 space-y-4">{children}</div>}
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full min-h-12 px-4 py-2 rounded-xl bg-[#0f1a30] border border-gray-600 text-white placeholder-gray-500 focus:border-[#4361ee] focus:outline-none transition-colors"
      />
    </div>
  );
}

export default function Setup({ onStart }: SetupScreenProps) {
  // Event Context
  const [games, setGames] = useState<GameType[]>([]);
  const [devices, setDevices] = useState<DeviceType[]>([]);
  const [playerCount, setPlayerCount] = useState<number | null>(null);
  const [customPlayerCount, setCustomPlayerCount] = useState('');

  // Network/ISP
  const [isp, setIsp] = useState('');
  const [connectionType, setConnectionType] = useState<ConnectionType | null>(null);
  const [routerModel, setRouterModel] = useState('');
  const [accessPoints, setAccessPoints] = useState<number | null | undefined>(undefined);

  // Venue
  const [venueName, setVenueName] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');

  // WiFi Scan
  const [rssi, setRssi] = useState('');
  const [wifiBand, setWifiBand] = useState<WiFiBand | null>(null);
  const [sameChannel, setSameChannel] = useState<string | null>(null);
  const [totalNetworks, setTotalNetworks] = useState<string | null>(null);

  // Session Mode
  const [mode, setMode] = useState<SessionMode>('event_monitor');

  // Pre-fill venue from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('venue_name');
    if (saved) setVenueName(saved);
  }, []);

  // Save venue name to localStorage when it changes
  useEffect(() => {
    if (venueName) {
      localStorage.setItem('venue_name', venueName);
    }
  }, [venueName]);

  const effectivePlayerCount = customPlayerCount ? parseInt(customPlayerCount, 10) : playerCount;
  const canStart = games.length > 0 && effectivePlayerCount !== null && effectivePlayerCount > 0;

  function toggleGame(game: GameType) {
    setGames((prev) =>
      prev.includes(game) ? prev.filter((g) => g !== game) : [...prev, game]
    );
  }

  function toggleDevice(device: DeviceType) {
    setDevices((prev) =>
      prev.includes(device) ? prev.filter((d) => d !== device) : [...prev, device]
    );
  }

  function handlePresetClick(count: number) {
    setPlayerCount(count);
    setCustomPlayerCount('');
  }

  function handleCustomPlayerChange(val: string) {
    setCustomPlayerCount(val);
    if (val) setPlayerCount(null);
  }

  function handleStart() {
    if (!canStart || !effectivePlayerCount) return;

    const hasWifiScan = rssi || wifiBand || sameChannel || totalNetworks;

    const config: SessionConfig = {
      id: crypto.randomUUID(),
      mode,
      startTime: Date.now(),
      games,
      devices,
      playerCount: effectivePlayerCount,
      venue: {
        name: venueName,
        city,
        country,
      },
      network: {
        isp,
        connectionType: connectionType ?? 'unknown',
        routerModel,
        accessPoints: accessPoints === undefined ? null : accessPoints,
      },
      passiveScan: hasWifiScan
        ? {
            rssiDbm: rssi ? parseInt(rssi, 10) : null,
            band: wifiBand ?? 'unknown',
            sameChannelNetworks: sameChannel ? sameChannelToNumber(sameChannel) : null,
            totalVisibleNetworks: totalNetworks ? totalNetworksToNumber(totalNetworks) : null,
          }
        : null,
      targetUrl: '',
    };

    onStart(config);
  }

  return (
    <div className="min-h-screen pb-24">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
        {/* Header */}
        <div className="text-center mb-2">
          <h1 className="text-2xl font-bold">Event Setup</h1>
          <p className="text-gray-400 text-sm mt-1">Configure your network monitoring session</p>
        </div>

        {/* Event Context */}
        <SectionCard title="Event Context">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Games</label>
            <div className="flex flex-wrap gap-2">
              {GAME_OPTIONS.map((opt) => (
                <Chip
                  key={opt.value}
                  label={opt.label}
                  selected={games.includes(opt.value)}
                  onToggle={() => toggleGame(opt.value)}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Device Types</label>
            <div className="flex flex-wrap gap-2">
              {DEVICE_OPTIONS.map((opt) => (
                <Chip
                  key={opt.value}
                  label={opt.label}
                  selected={devices.includes(opt.value)}
                  onToggle={() => toggleDevice(opt.value)}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Player Count</label>
            <div className="flex flex-wrap gap-2">
              {PLAYER_PRESETS.map((count) => (
                <Chip
                  key={count}
                  label={String(count)}
                  selected={playerCount === count && !customPlayerCount}
                  onToggle={() => handlePresetClick(count)}
                />
              ))}
            </div>
            <div className="mt-3">
              <input
                type="number"
                value={customPlayerCount}
                onChange={(e) => handleCustomPlayerChange(e.target.value)}
                placeholder="Custom count"
                min={1}
                className="w-full min-h-12 px-4 py-2 rounded-xl bg-[#0f1a30] border border-gray-600 text-white placeholder-gray-500 focus:border-[#4361ee] focus:outline-none transition-colors"
              />
            </div>
          </div>
        </SectionCard>

        {/* Network / ISP Info */}
        <SectionCard title="Network / ISP Info" collapsible defaultOpen={false}>
          <TextInput label="ISP Name" value={isp} onChange={setIsp} placeholder="e.g. Comcast, AT&T" />

          <div>
            <label className="block text-sm text-gray-400 mb-2">Connection Type</label>
            <div className="flex flex-wrap gap-2">
              {CONNECTION_OPTIONS.map((opt) => (
                <Chip
                  key={opt.value}
                  label={opt.label}
                  selected={connectionType === opt.value}
                  onToggle={() => setConnectionType(connectionType === opt.value ? null : opt.value)}
                />
              ))}
            </div>
          </div>

          <TextInput
            label="Router/Modem Model"
            value={routerModel}
            onChange={setRouterModel}
            placeholder="What does it say on the box?"
          />

          <div>
            <label className="block text-sm text-gray-400 mb-2">WiFi Access Points in Play Area</label>
            <div className="flex flex-wrap gap-2">
              {AP_OPTIONS.map((opt) => (
                <Chip
                  key={String(opt.value)}
                  label={opt.label}
                  selected={accessPoints === opt.value}
                  onToggle={() => setAccessPoints(accessPoints === opt.value ? undefined : opt.value)}
                />
              ))}
            </div>
          </div>
        </SectionCard>

        {/* Venue */}
        <SectionCard title="Venue">
          <TextInput label="Store / Venue Name" value={venueName} onChange={setVenueName} placeholder="e.g. Local Game Store" />
          <TextInput label="City" value={city} onChange={setCity} placeholder="e.g. Seattle" />
          <TextInput label="Country" value={country} onChange={setCountry} placeholder="e.g. United States" />
        </SectionCard>

        {/* Quick WiFi Scan */}
        <SectionCard title="Quick WiFi Scan" collapsible defaultOpen={false}>
          <TextInput
            label="Signal Strength (dBm)"
            value={rssi}
            onChange={setRssi}
            placeholder="-50 to -90"
            type="number"
          />

          <div>
            <label className="block text-sm text-gray-400 mb-2">WiFi Band</label>
            <div className="flex flex-wrap gap-2">
              {WIFI_BAND_OPTIONS.map((opt) => (
                <Chip
                  key={opt.value}
                  label={opt.label}
                  selected={wifiBand === opt.value}
                  onToggle={() => setWifiBand(wifiBand === opt.value ? null : opt.value)}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Networks on Same Channel</label>
            <div className="flex flex-wrap gap-2">
              {SAME_CHANNEL_OPTIONS.map((opt) => (
                <Chip
                  key={opt.value}
                  label={opt.label}
                  selected={sameChannel === opt.value}
                  onToggle={() => setSameChannel(sameChannel === opt.value ? null : opt.value)}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">Total Visible Networks</label>
            <div className="flex flex-wrap gap-2">
              {TOTAL_NETWORKS_OPTIONS.map((opt) => (
                <Chip
                  key={opt.value}
                  label={opt.label}
                  selected={totalNetworks === opt.value}
                  onToggle={() => setTotalNetworks(totalNetworks === opt.value ? null : opt.value)}
                />
              ))}
            </div>
          </div>
        </SectionCard>

        {/* Session Mode */}
        <SectionCard title="Session Mode">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMode('event_monitor')}
              className={`p-4 rounded-xl text-left transition-colors cursor-pointer ${
                mode === 'event_monitor'
                  ? 'bg-[#4361ee] border border-[#4361ee]'
                  : 'bg-[#0f1a30] border border-gray-600 hover:border-gray-400'
              }`}
            >
              <div className="font-semibold text-sm">Event Monitor</div>
              <p className="text-xs text-gray-300 mt-1">Continuous monitoring during a live event with round tagging</p>
            </button>
            <button
              type="button"
              onClick={() => setMode('load_test')}
              className={`p-4 rounded-xl text-left transition-colors cursor-pointer ${
                mode === 'load_test'
                  ? 'bg-[#4361ee] border border-[#4361ee]'
                  : 'bg-[#0f1a30] border border-gray-600 hover:border-gray-400'
              }`}
            >
              <div className="font-semibold text-sm">Load Test</div>
              <p className="text-xs text-gray-300 mt-1">Quick burst test to stress-test the network before an event</p>
            </button>
          </div>
        </SectionCard>
      </div>

      {/* Bottom-anchored Start Button */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-[#1a1a2e]/95 backdrop-blur-sm border-t border-gray-800">
        <div className="max-w-lg mx-auto">
          <button
            type="button"
            onClick={handleStart}
            disabled={!canStart}
            className={`w-full min-h-12 rounded-xl font-semibold text-lg transition-colors cursor-pointer ${
              canStart
                ? 'bg-[#4361ee] hover:bg-[#3a56d4] text-white'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            {mode === 'load_test' ? 'Start Load Test' : 'Start Monitoring'}
          </button>
        </div>
      </div>
    </div>
  );
}
