# Solar Meter API

A Cloudflare Workers TypeScript API that retrieves solar meter data from a D1 database.

## Features

- **TypeScript** for type-safe code
- **Hono** framework for lightweight routing
- **Cloudflare D1** database integration
- **Workers** serverless platform

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ installed
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) CLI installed globally
- A Cloudflare account with D1 database access
- A D1 database named `solar_meter_values` with a `DayData` table

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure Wrangler:**
   Update `wrangler.toml` with your:
   - `database_id`: Your D1 database ID
   - `zone_id`: Your Cloudflare zone ID (if deploying to a domain)

   To find your database ID:
   ```bash
   wrangler d1 list
   ```

3. **Local Development:**
   ```bash
   npm run dev
   ```
   The API will be available at `http://localhost:8787`

4. **Type Checking:**
   ```bash
   npm run type-check
   ```

## API Endpoints

### GET `/health`
Health check endpoint.

**Response:**
```json
{
  "status": "ok"
}
```

### GET `/current`
Retrieves the latest solar meter data.

**Response:**
```json
{
  "success": true,
  "data": {
    "power": 1234,
    "timestamp": "2024-01-15 14:35:00",
    "total_yield": 5678
  }
}
```

**Error Response (404):**
```json
{
  "error": "No data found"
}
```

**Error Response (500):**
```json
{
  "success": false,
  "error": "Failed to fetch solar meter data",
  "details": "error message"
}
```

## Deployment

Deploy to Cloudflare Workers:

```bash
npm run deploy
```

## Database Schema

The `DayData` table should have at least the following columns:
- `Power` (numeric) - Current power output
- `TotalYield` (numeric) - Total energy yield

## Development Notes

- The timestamp in the SQL query uses a hardcoded Unix timestamp (1766823300). Update this to use dynamic values as needed.
- Error handling includes detailed error messages for debugging during development.
- TypeScript strict mode is enabled for better type safety.

## License

MIT
