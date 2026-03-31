interface Env {
  DB: D1Database;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const RATE_LIMIT = 10; // max submissions per IP per day

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  'schema_version',
  'session',
  'event',
  'network',
  'wifi_environment',
  'speed_results',
  'game_performance',
  'scoring',
]);

async function hashIP(ip: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip + ':pkmn-benchmark-salt');
  const hash = await crypto.subtle.digest('SHA-256', data);
  const arr = new Uint8Array(hash);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ status: 'error', message }, status);
}

function stripUnexpectedKeys(
  data: Record<string, unknown>
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const key of ALLOWED_TOP_LEVEL_KEYS) {
    if (key in data) {
      cleaned[key] = data[key];
    }
  }
  return cleaned;
}

interface BenchmarkSubmission {
  schema_version: string;
  session?: {
    mode?: string;
    date?: string;
    duration_minutes?: number;
  };
  event?: {
    venue?: string;
    region?: string;
    player_count?: number;
    games?: string[];
    devices?: string[];
  };
  network?: {
    isp?: string;
    connection_type?: string;
    access_points?: number;
  };
  wifi_environment?: {
    rssi_dbm?: number;
    band?: string;
    same_channel_networks?: number;
    total_visible_networks?: number;
  };
  speed_results?: {
    download?: { avg_mbps?: number; min_mbps?: number };
    upload?: { avg_mbps?: number };
    latency?: { avg_ms?: number; max_ms?: number };
    jitter?: { avg_ms?: number };
  };
  game_performance?: {
    stability_pct?: number;
    lag_events?: number;
    disconnects?: number;
  };
}

function validate(data: unknown): {
  ok: boolean;
  error?: string;
  submission?: BenchmarkSubmission;
} {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Request body must be a JSON object' };
  }

  const d = data as Record<string, unknown>;

  if (d.schema_version !== '2.0') {
    return {
      ok: false,
      error: "schema_version must be '2.0'",
    };
  }

  const session = d.session as BenchmarkSubmission['session'];
  if (!session?.date) {
    return { ok: false, error: 'session.date is required' };
  }

  const event = d.event as BenchmarkSubmission['event'];
  if (!event?.player_count || event.player_count <= 0) {
    return { ok: false, error: 'event.player_count must be greater than 0' };
  }

  return { ok: true, submission: d as unknown as BenchmarkSubmission };
}

async function handleSubmit(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse('POST required', 405);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body');
  }

  const validation = validate(body);
  if (!validation.ok) {
    return errorResponse(validation.error!);
  }

  // Rate limiting by hashed IP
  const clientIP = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const ipHash = await hashIP(clientIP);
  const today = new Date().toISOString().split('T')[0];

  const rateLimitCheck = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM submissions WHERE ip_hash = ? AND date(submitted_at) = ?'
  )
    .bind(ipHash, today)
    .first<{ cnt: number }>();

  if (rateLimitCheck && rateLimitCheck.cnt >= RATE_LIMIT) {
    return errorResponse(
      `Rate limit exceeded: max ${RATE_LIMIT} submissions per day`,
      429
    );
  }

  const cleaned = stripUnexpectedKeys(body as Record<string, unknown>);
  const sub = cleaned as unknown as BenchmarkSubmission;

  const id = crypto.randomUUID();
  const submittedAt = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO submissions (
      id, submitted_at, schema_version, ip_hash,
      session_mode, venue, region, date, duration_minutes,
      games, devices, player_count,
      isp, connection_type, access_points,
      rssi_dbm, wifi_band, same_channel_networks, total_visible_networks,
      avg_download, min_download, avg_upload,
      avg_latency, max_latency, avg_jitter,
      stability_pct, lag_events, disconnects,
      full_data
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?
    )`
  )
    .bind(
      id,
      submittedAt,
      sub.schema_version,
      ipHash,
      sub.session?.mode ?? null,
      sub.event?.venue ?? null,
      sub.event?.region ?? null,
      sub.session?.date ?? null,
      sub.session?.duration_minutes ?? null,
      sub.event?.games ? JSON.stringify(sub.event.games) : null,
      sub.event?.devices ? JSON.stringify(sub.event.devices) : null,
      sub.event?.player_count ?? null,
      sub.network?.isp ?? null,
      sub.network?.connection_type ?? null,
      sub.network?.access_points ?? null,
      sub.wifi_environment?.rssi_dbm ?? null,
      sub.wifi_environment?.band ?? null,
      sub.wifi_environment?.same_channel_networks ?? null,
      sub.wifi_environment?.total_visible_networks ?? null,
      sub.speed_results?.download?.avg_mbps ?? null,
      sub.speed_results?.download?.min_mbps ?? null,
      sub.speed_results?.upload?.avg_mbps ?? null,
      sub.speed_results?.latency?.avg_ms ?? null,
      sub.speed_results?.latency?.max_ms ?? null,
      sub.speed_results?.jitter?.avg_ms ?? null,
      sub.game_performance?.stability_pct ?? null,
      sub.game_performance?.lag_events ?? null,
      sub.game_performance?.disconnects ?? null,
      JSON.stringify(cleaned)
    )
    .run();

  return jsonResponse({ status: 'ok', id }, 201);
}

async function handleStats(env: Env): Promise<Response> {
  const totals = await env.DB.prepare(
    `SELECT
      COUNT(*) as total_submissions,
      AVG(avg_download) as avg_download,
      AVG(avg_upload) as avg_upload,
      AVG(avg_latency) as avg_latency,
      AVG(avg_jitter) as avg_jitter,
      AVG(stability_pct) as avg_stability,
      AVG(player_count) as avg_player_count,
      MIN(submitted_at) as earliest_submission,
      MAX(submitted_at) as latest_submission
    FROM submissions`
  ).first();

  const byRegion = await env.DB.prepare(
    `SELECT region, COUNT(*) as count
     FROM submissions
     WHERE region IS NOT NULL
     GROUP BY region
     ORDER BY count DESC
     LIMIT 20`
  ).all();

  const byVenue = await env.DB.prepare(
    `SELECT venue, COUNT(*) as count
     FROM submissions
     WHERE venue IS NOT NULL
     GROUP BY venue
     ORDER BY count DESC
     LIMIT 20`
  ).all();

  const byConnectionType = await env.DB.prepare(
    `SELECT connection_type, COUNT(*) as count
     FROM submissions
     WHERE connection_type IS NOT NULL
     GROUP BY connection_type
     ORDER BY count DESC`
  ).all();

  return jsonResponse(
    {
      status: 'ok',
      aggregates: totals ?? {},
      by_region: byRegion.results,
      by_venue: byVenue.results,
      by_connection_type: byConnectionType.results,
    },
    200,
    { 'Cache-Control': 'public, max-age=3600' }
  );
}

export default {
  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    switch (url.pathname) {
      case '/api/submit':
        return handleSubmit(request, env);

      case '/api/stats':
        if (request.method !== 'GET') {
          return errorResponse('GET required', 405);
        }
        return handleStats(env);

      default:
        return jsonResponse({ status: 'error', message: 'Not found' }, 404);
    }
  },
} satisfies ExportedHandler<Env>;
