const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

const MAX_BYTES = 5 * 1024 * 1024; // 5MB

function generateRandomBytes(size: number): Uint8Array {
  const data = new Uint8Array(size);
  // crypto.getRandomValues has a 65536-byte limit per call
  for (let offset = 0; offset < size; offset += 65536) {
    const chunk = new Uint8Array(data.buffer, offset, Math.min(65536, size - offset));
    crypto.getRandomValues(chunk);
  }
  return data;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    switch (url.pathname) {
      case '/ping':
        return new Response('pong', { headers: CORS_HEADERS });

      case '/down': {
        const bytes = Math.min(
          parseInt(url.searchParams.get('bytes') || '0', 10) || 0,
          MAX_BYTES
        );
        if (bytes <= 0) {
          return new Response('bytes parameter required (1 to 5242880)', {
            status: 400,
            headers: CORS_HEADERS,
          });
        }
        const data = generateRandomBytes(bytes);
        return new Response(data, {
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/octet-stream',
            'Content-Length': bytes.toString(),
          },
        });
      }

      case '/up': {
        if (request.method !== 'POST') {
          return new Response('POST required', { status: 405, headers: CORS_HEADERS });
        }
        const body = await request.arrayBuffer();
        return new Response(JSON.stringify({ bytes: body.byteLength }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response('Not found', { status: 404, headers: CORS_HEADERS });
    }
  },
} satisfies ExportedHandler;
