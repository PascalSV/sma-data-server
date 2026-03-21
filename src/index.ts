import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';

interface SolarMeterData {
    power: number;
    timestamp: string;
    total_yield: number;
    totalYieldDifferenceToday: number | null;
    maxPowerToday: number | null;
}

interface DayDataRecord {
    TimeStamp: number;
    Serial: string;
    Power: number;
    TotalYield: number;
    LastChangedAt: string;
}

interface CurrentAndMaxData {
    totalYieldDifference: number | null;
    maxPower: number | null;
    currentPower: number | null;
    latestTimestamp: string | null;
}

interface CloudflareEnv {
    DB: D1Database;
    SMA_DATA_SERVER_API_SECRET: string;
}

const app = new Hono<{ Bindings: CloudflareEnv }>();

const validateApiSecret = async (c: any, next: any) => {
    const apiSecret = c.env.SMA_DATA_SERVER_API_SECRET;

    if (!apiSecret) {
        console.error('SMA_DATA_SERVER_API_SECRET environment variable is not configured');
        return c.json(
            {
                success: false,
                error: 'Server configuration error',
                message: 'SMA_DATA_SERVER_API_SECRET is not configured',
            },
            { status: 500 }
        );
    }

    // Get the secret from Authorization header (Bearer token) or x-api-key header
    const authHeader = c.req.header('authorization');
    const apiKeyHeader = c.req.header('x-api-key');

    let providedSecret: string | null = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        providedSecret = authHeader.substring(7);
    } else if (apiKeyHeader) {
        providedSecret = apiKeyHeader;
    }

    if (!providedSecret) {
        console.warn('API authentication failed: No API key provided', {
            endpoint: '/new_entries',
            clientIp: c.req.header('cf-connecting-ip'),
            userAgent: c.req.header('user-agent'),
        });
        return c.json(
            {
                success: false,
                error: 'Authentication required',
                message: 'Please provide an API key via Authorization header (Bearer token) or X-API-Key header',
            },
            { status: 401 }
        );
    }

    if (providedSecret !== apiSecret) {
        console.warn('API authentication failed: Invalid API key', {
            endpoint: '/new_entries',
            clientIp: c.req.header('cf-connecting-ip'),
            userAgent: c.req.header('user-agent'),
        });
        return c.json(
            {
                success: false,
                error: 'Authentication failed',
                message: 'Invalid API key',
            },
            { status: 403 }
        );
    }

    // Authentication successful
    console.info('API authentication successful', {
        endpoint: '/new_entries',
        clientIp: c.req.header('cf-connecting-ip'),
    });

    await next();
};

// Health check endpoint
app.get('/health', (c) => {
    return c.json({ status: 'ok' });
});

// Current data endpoint
app.get('/current', async (c) => {
    try {
        const db = c.env.DB;

        const sql = `
            WITH normalized AS (
                SELECT
                    Power,
                    TotalYield,
                    CASE
                        WHEN TimeStamp > 9999999999 THEN CAST(TimeStamp / 1000 AS INT)
                        ELSE CAST(TimeStamp AS INT)
                    END AS ts_sec
                FROM PascalsDayData
            ),
            bounded AS (
                SELECT *
                FROM normalized
                WHERE ts_sec <= CAST(strftime('%s','now') AS INT) + 300
            ),
            latest AS (
                SELECT *
                FROM bounded
                ORDER BY ts_sec DESC
                LIMIT 1
            ),
            today AS (
                SELECT *
                FROM bounded
                WHERE ts_sec >= CAST(strftime('%s','now','start of day') AS INT)
            ),
            first_today AS (
                SELECT TotalYield
                FROM today
                ORDER BY ts_sec ASC
                LIMIT 1
            ),
            max_today AS (
                SELECT MAX(Power) AS max_power_today
                FROM today
            )
            SELECT
                latest.Power AS power,
                strftime('%Y-%m-%d %H:%M:%S', latest.ts_sec, 'unixepoch') AS timestamp,
                latest.TotalYield AS total_yield,
                CASE
                    WHEN latest.TotalYield IS NOT NULL AND first_today.TotalYield IS NOT NULL
                    THEN latest.TotalYield - first_today.TotalYield
                    ELSE NULL
                END AS totalYieldDifferenceToday,
                max_today.max_power_today AS maxPowerToday
            FROM latest
            LEFT JOIN first_today ON 1 = 1
            LEFT JOIN max_today ON 1 = 1;
        `;

        const result = await db.prepare(sql).first<SolarMeterData>();

        if (!result) {
            return c.json(
                { error: 'No data found' },
                { status: 404 }
            );
        }

        return c.json({
            success: true,
            data: {
                power: result.power,
                timestamp: result.timestamp,
                total_yield: result.total_yield,
                totalYieldDifferenceToday: result.totalYieldDifferenceToday,
                maxPowerToday: result.maxPowerToday,
            },
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        return c.json(
            {
                success: false,
                error: 'Failed to fetch solar meter data',
                details: errorMessage,
            },
            { status: 500 }
        );
    }
});

// Current and max data endpoint
app.get('/current-and-max', async (c) => {
    try {
        const db = c.env.DB;
        const currentAndMaxSql = `
            WITH normalized AS (
                SELECT
                    Power,
                    TotalYield,
                    CASE
                        WHEN TimeStamp > 9999999999 THEN CAST(TimeStamp / 1000 AS INT)
                        ELSE CAST(TimeStamp AS INT)
                    END AS ts_sec
                FROM PascalsDayData
            ),
            bounded AS (
                SELECT *
                FROM normalized
                WHERE ts_sec <= CAST(strftime('%s','now') AS INT) + 300
            ),
            latest AS (
                SELECT *
                FROM bounded
                ORDER BY ts_sec DESC
                LIMIT 1
            ),
            today AS (
                SELECT *
                FROM bounded
                WHERE ts_sec >= CAST(strftime('%s','now','start of day') AS INT)
            ),
            first_today AS (
                SELECT TotalYield
                FROM today
                ORDER BY ts_sec ASC
                LIMIT 1
            ),
            max_today AS (
                SELECT MAX(Power) AS maxPower
                FROM today
            )
            SELECT
                CASE
                    WHEN latest.TotalYield IS NOT NULL AND first_today.TotalYield IS NOT NULL
                    THEN latest.TotalYield - first_today.TotalYield
                    ELSE NULL
                END AS totalYieldDifference,
                max_today.maxPower AS maxPower,
                latest.Power AS currentPower,
                strftime('%Y-%m-%d %H:%M:%S', latest.ts_sec, 'unixepoch') AS latestTimestamp
            FROM latest
            LEFT JOIN first_today ON 1 = 1
            LEFT JOIN max_today ON 1 = 1;
        `;
        const result = await db.prepare(currentAndMaxSql).first<CurrentAndMaxData>();

        if (!result || !result.latestTimestamp) {
            return c.json(
                { error: 'No data found' },
                { status: 404 }
            );
        }

        return c.json({
            success: true,
            data: result,
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return c.json(
            {
                success: false,
                error: 'Failed to fetch current and max data',
                details: errorMessage,
            },
            { status: 500 }
        );
    }
});

// Max yield and date endpoint
app.get('/max-yield', async (c) => {
    try {
        const db = c.env.DB;
        const maxValueAndDateSql = `
            SELECT a.TimeStamp, a.Serial, a.TotalYield, a.Power, a.LastChangedAt 
            FROM PascalsDayData a 
            INNER JOIN (
                SELECT MAX(Power) as MaxPower 
                FROM PascalsDayData
            ) b ON a.Power = b.MaxPower 
            LIMIT 1;
        `;
        const maxValueAndDate = await db.prepare(maxValueAndDateSql).first<DayDataRecord>();

        const result: DayDataRecord[] = [];
        if (maxValueAndDate) {
            result.push(maxValueAndDate);
        }

        return c.json({
            success: true,
            data: result,
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return c.json(
            {
                success: false,
                error: 'Failed to fetch max yield data',
                details: errorMessage,
            },
            { status: 500 }
        );
    }
});

// Today's data endpoint
app.get('/today', async (c) => {
    try {
        const db = c.env.DB;
        const allDaysDataSql = `
            SELECT TimeStamp, Serial, TotalYield, Power, LastChangedAt 
            FROM PascalsDayData 
            WHERE TimeStamp >= CAST(strftime('%s','now','start of day') AS INT) 
            ORDER BY TimeStamp DESC;
        `;
        const response = await db.prepare(allDaysDataSql).all<DayDataRecord>();
        const rows = response?.results || [];

        return c.json({
            success: true,
            data: rows,
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return c.json(
            {
                success: false,
                error: 'Failed to fetch today\'s data',
                details: errorMessage,
            },
            { status: 500 }
        );
    }
});

// Yearly yield endpoint
app.get('/yearly-yield', async (c) => {
    try {
        const db = c.env.DB;
        const yearlyYieldSql = `
            SELECT 
                strftime('%Y', timestamp, 'unixepoch') AS year,
                MAX(TotalYield) AS total_yield
            FROM PascalsDayData
            GROUP BY strftime('%Y', timestamp, 'unixepoch')
            ORDER BY year DESC;
        `;

        const response = await db.prepare(yearlyYieldSql).all<{ year: string; total_yield: number }>();
        const rows = response?.results || [];

        return c.json({
            success: true,
            data: rows,
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return c.json(
            {
                success: false,
                error: 'Failed to fetch yearly yield data',
                details: errorMessage,
            },
            { status: 500 }
        );
    }
});

// New entries endpoint - upsert records
app.post('/new_entries', validateApiSecret, async (c) => {
    try {
        const db = c.env.DB;
        const body = await c.req.json();

        // Ensure body is an array
        const entries = Array.isArray(body) ? body : [body];

        if (entries.length === 0) {
            return c.json(
                {
                    success: false,
                    error: 'No entries provided',
                },
                { status: 400 }
            );
        }

        // Validate entries
        const validEntries: DayDataRecord[] = [];
        const errors: { index: number; message: string }[] = [];

        entries.forEach((entry: any, index: number) => {
            if (!entry.TimeStamp || !entry.Serial || entry.Power === undefined || entry.TotalYield === undefined || !entry.LastChangedAt) {
                errors.push({
                    index,
                    message: 'Missing required fields: TimeStamp, Serial, Power, TotalYield, LastChangedAt',
                });
            } else {
                validEntries.push(entry as DayDataRecord);
            }
        });

        if (validEntries.length === 0) {
            return c.json(
                {
                    success: false,
                    error: 'No valid entries to insert',
                    validationErrors: errors,
                },
                { status: 400 }
            );
        }

        // Upsert valid entries
        const results = [];
        let successCount = 0;
        let failureCount = 0;

        for (const entry of validEntries) {
            const upsertSql = `
                INSERT INTO PascalsDayData (TimeStamp, Serial, Power, TotalYield, LastChangedAt)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(TimeStamp) DO UPDATE SET
                    Serial = excluded.Serial,
                    Power = excluded.Power,
                    TotalYield = excluded.TotalYield,
                    LastChangedAt = excluded.LastChangedAt;
            `;

            try {
                console.info('Attempting to upsert entry', {
                    timestamp: entry.TimeStamp,
                    serial: entry.Serial,
                    power: entry.Power,
                    totalYield: entry.TotalYield,
                });

                const result = await db.prepare(upsertSql).bind(
                    entry.TimeStamp,
                    entry.Serial,
                    entry.Power,
                    entry.TotalYield,
                    entry.LastChangedAt
                ).run();

                console.info('Upsert successful', {
                    timestamp: entry.TimeStamp,
                    serial: entry.Serial,
                    dbResult: result,
                });

                results.push({
                    timestamp: entry.TimeStamp,
                    serial: entry.Serial,
                    status: 'inserted_or_updated',
                });
                successCount++;
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                console.error('Upsert failed', {
                    timestamp: entry.TimeStamp,
                    serial: entry.Serial,
                    error: errorMessage,
                    fullError: error,
                });

                results.push({
                    timestamp: entry.TimeStamp,
                    serial: entry.Serial,
                    status: 'failed',
                    error: errorMessage,
                });
                failureCount++;
            }
        }

        return c.json({
            success: failureCount === 0,
            inserted: successCount,
            failed: failureCount,
            total: validEntries.length,
            results,
            validationErrors: errors.length > 0 ? errors : undefined,
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('new_entries endpoint error', {
            error: errorMessage,
            fullError: error,
        });

        return c.json(
            {
                success: false,
                error: 'Failed to insert new entries',
                details: errorMessage,
            },
            { status: 500 }
        );
    }
});

// Catch-all for undefined routes
app.all('*', (c) => {
    return c.json(
        { error: 'Not Found', message: 'The requested endpoint does not exist' },
        { status: 404 }
    );
});

export default app;
