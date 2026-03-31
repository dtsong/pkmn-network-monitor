# Pokemon Event Network Monitor

A live telemetry PWA that Pokemon Professors run during tournaments to capture real network performance data. After a session, the tool generates an XLSX report with findings and recommendations, and offers one-tap contribution to a shared global benchmark database.

**Core principle:** This tool measures, it does not estimate. Run it during a real event with real devices connected. The data reflects what actually happened.

## Architecture

- **Frontend:** Vite + React + TypeScript + Tailwind CSS (PWA)
- **Speed Test Endpoint:** Cloudflare Worker (`/ping`, `/down`, `/up`)
- **Benchmark API:** Cloudflare Worker + D1 (crowdsourced session data)
- **Measurement Engine:** Web Worker for background-resilient measurements

## Development

```bash
npm install
npm run dev
```

## License

MIT
