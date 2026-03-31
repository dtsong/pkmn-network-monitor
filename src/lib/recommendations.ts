import type {
  Severity,
  Recommendation,
  SessionScore,
  PassiveScan,
  EventTag,
  MeasurementReading,
} from '../types/index.ts';

const SEVERITY_ORDER: Record<Severity, number> = {
  high: 0,
  medium: 1,
  informational: 2,
};

function sortBySeverity(recs: Recommendation[]): Recommendation[] {
  return recs.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function generateRecommendations(
  sessionScore: SessionScore,
  events: EventTag[],
  readings: MeasurementReading[],
  playerCount: number,
  accessPoints: number | null,
  passiveScan: PassiveScan | null,
): Recommendation[] {
  const recs: Recommendation[] = [];
  let counter = 0;

  function addRec(
    severity: Severity,
    trigger: string,
    title: string,
    message: string,
  ): void {
    counter++;
    recs.push({
      id: `rec_${counter}`,
      severity,
      trigger,
      title,
      message,
    });
  }

  const { metrics, eventCorrelations } = sessionScore;

  // === Active Measurement Triggers ===

  // Low download speed
  if (metrics.minDownload < 5) {
    addRec(
      'high',
      'minDownload < 5',
      'Low download speed',
      `Download speed dropped as low as ${round(metrics.minDownload)} Mbps during the session. Speeds below 5 Mbps can cause lag with multiple connected devices.`,
    );
  }

  // Latency spike
  if (metrics.maxLatency > 200) {
    addRec(
      'high',
      'maxLatency > 200',
      'Latency spike',
      `Latency spiked to ${round(metrics.maxLatency)}ms at its worst. Spikes above 200ms could cause noticeable lag during gameplay.`,
    );
  }

  // High jitter
  if (metrics.avgJitter > 30) {
    addRec(
      'high',
      'avgJitter > 30',
      'High jitter',
      `Jitter averaged ${round(metrics.avgJitter)}ms, which causes inconsistent gameplay. Players may experience intermittent lag.`,
    );
  }

  // Connection instability
  if (metrics.avgStability < 95) {
    const failPct = round(100 - metrics.avgStability);
    addRec(
      'high',
      'avgStability < 95',
      'Connection instability',
      `${failPct}% of network requests failed during the session. This level of packet loss could cause disconnects.`,
    );
  }

  // Disconnect events
  const disconnectCount = events.filter((e) => e.type === 'disconnect').length;
  if (disconnectCount > 0) {
    addRec(
      'high',
      'disconnectCount > 0',
      'Disconnects logged',
      `${disconnectCount} disconnect event(s) were logged during the session.`,
    );
  }

  // Lag events
  const lagEvents = events.filter((e) => e.type === 'lag_reported');
  const lagEventCount = lagEvents.length;
  if (lagEventCount > 0) {
    addRec(
      'medium',
      'lagEventCount > 0',
      'Lag reports logged',
      `${lagEventCount} lag report(s) were logged during the session.`,
    );
  }

  // Lag correlates with speed drops
  // Only flag when the correlated reading's download was below the session average
  const lagCorrelations = eventCorrelations.filter(
    (c) => c.eventType === 'lag_reported',
  );
  if (lagCorrelations.length > 0) {
    const readingMap = new Map(readings.map((r) => [r.id, r]));
    const lagTimestamps = lagEvents
      .filter((e) => {
        const corr = lagCorrelations.find((c) => c.eventId === e.id);
        if (!corr) return false;
        const reading = readingMap.get(corr.readingId);
        return reading !== undefined && reading.download < metrics.avgDownload;
      })
      .map((e) => {
        const mins = Math.round(e.elapsedMs / 60000);
        return `${mins}m`;
      });
    if (lagTimestamps.length > 0) {
      addRec(
        'medium',
        'lag correlates with speed drops',
        'Lag correlates with speed drops',
        `Lag reports at ${lagTimestamps.join(', ')} coincide with measured speed drops, suggesting the network struggled during those moments.`,
      );
    }
  }

  // Low per-device bandwidth
  if (metrics.perDeviceBandwidth < 2) {
    addRec(
      'medium',
      'perDeviceBandwidth < 2',
      'Low per-device bandwidth',
      `With ${playerCount} devices, each averaged about ${round(metrics.perDeviceBandwidth)} Mbps. Under 2 Mbps per device could cause issues.`,
    );
  }

  // Tight bandwidth for large event
  if (metrics.avgDownload < 25 && playerCount > 16) {
    addRec(
      'medium',
      'avgDownload < 25 AND playerCount > 16',
      'Tight bandwidth for large event',
      `${round(metrics.avgDownload)} Mbps average for ${playerCount} players is tight. Consider a backup connection for events this size.`,
    );
  }

  // Single access point
  if (accessPoints === 1 && playerCount > 16) {
    addRec(
      'medium',
      'accessPoints == 1 AND playerCount > 16',
      'Single access point',
      `Only one access point for ${playerCount}+ players. A second AP could reduce WiFi contention.`,
    );
  }

  // === Passive Scan Triggers ===

  if (passiveScan) {
    // Weak WiFi signal
    if (passiveScan.rssiDbm !== null && passiveScan.rssiDbm < -70) {
      addRec(
        'high',
        'rssi < -70',
        'Weak WiFi signal',
        `WiFi signal at the play area is weak (${passiveScan.rssiDbm} dBm). Consider moving the router closer or adding an access point.`,
      );
    }

    // Marginal WiFi signal
    if (
      passiveScan.rssiDbm !== null &&
      passiveScan.rssiDbm >= -70 &&
      passiveScan.rssiDbm <= -67
    ) {
      addRec(
        'medium',
        'rssi between -67 and -70',
        'Marginal WiFi signal',
        `WiFi signal at the play area is marginal (${passiveScan.rssiDbm} dBm). Monitor for issues during peak usage.`,
      );
    }

    // Channel congestion
    if (
      passiveScan.sameChannelNetworks !== null &&
      passiveScan.sameChannelNetworks >= 3
    ) {
      addRec(
        'medium',
        'sameChannelNetworks >= 3',
        'Channel congestion',
        `${passiveScan.sameChannelNetworks} other networks are using the same WiFi channel. Channel interference could cause intermittent lag.`,
      );
    }

    // 2.4 GHz only
    if (passiveScan.band === '2.4ghz' && playerCount > 12) {
      addRec(
        'medium',
        "band == '2.4ghz' AND playerCount > 12",
        '2.4 GHz only',
        `The store's WiFi is on 2.4 GHz only. 5 GHz or 6 GHz offers better performance for gaming with ${playerCount} players.`,
      );
    }

    // Dense WiFi environment
    if (
      passiveScan.totalVisibleNetworks !== null &&
      passiveScan.totalVisibleNetworks >= 16
    ) {
      addRec(
        'medium',
        'totalVisibleNetworks >= 16',
        'Dense WiFi environment',
        `${passiveScan.totalVisibleNetworks} WiFi networks are visible at this location. This level of congestion can degrade performance.`,
      );
    }
  }

  // === No Issues Fallback ===

  if (recs.length === 0) {
    addRec(
      'informational',
      'no issues',
      'No major issues',
      'No major issues detected during this session. Network performance was adequate for the event.',
    );
  }

  return sortBySeverity(recs);
}

export function generateLoadTestRecommendations(
  readings: MeasurementReading[],
  playerCount: number,
): Recommendation[] {
  const recs: Recommendation[] = [];
  let counter = 0;

  function addRec(
    severity: Severity,
    trigger: string,
    title: string,
    message: string,
  ): void {
    counter++;
    recs.push({
      id: `rec_${counter}`,
      severity,
      trigger,
      title,
      message,
    });
  }

  if (readings.length < 2) {
    return recs;
  }

  const firstDownload = readings[0].download;
  const lastDownload = readings[readings.length - 1].download;

  if (firstDownload > 0) {
    const degradation =
      ((firstDownload - lastDownload) / firstDownload) * 100;

    if (degradation > 50) {
      addRec(
        'high',
        'degradation > 50%',
        'Significant speed degradation',
        `Download speed dropped ${round(degradation)}% from ${round(firstDownload)} Mbps to ${round(lastDownload)} Mbps over the load test with ${playerCount} players. The network may not handle this many concurrent devices.`,
      );
    } else if (degradation > 25) {
      addRec(
        'medium',
        'degradation > 25%',
        'Moderate speed degradation',
        `Download speed dropped ${round(degradation)}% from ${round(firstDownload)} Mbps to ${round(lastDownload)} Mbps over the load test with ${playerCount} players. Performance may degrade further with more devices.`,
      );
    }
  }

  if (recs.length === 0) {
    addRec(
      'informational',
      'no degradation',
      'Stable under load',
      `Download speed remained stable throughout the load test with ${playerCount} players. The network handled the simulated load well.`,
    );
  }

  return sortBySeverity(recs);
}
