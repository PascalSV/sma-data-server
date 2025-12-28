import { Hono } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';

interface SolarMeterData {
    power: number;
    timestamp: string;
    total_yield: number;
}

interface DayDataRecord {
    TimeStamp: number;
    Serial: string;
    Power: number;
    TotalYield: number;
    LastChangedAt: string;
}

interface CloudflareEnv {
    DB: D1Database;
    CLIENT_CERT_SUBJECT: string;
}

const app = new Hono<{ Bindings: CloudflareEnv }>();

// Middleware to validate client certificate
const validateClientCertificate = async (c: any, next: any) => {
    const expectedSubject = c.env.CLIENT_CERT_SUBJECT;

    if (!expectedSubject) {
        return c.json(
            {
                success: false,
                error: 'Server configuration error',
                message: 'CLIENT_CERT_SUBJECT environment variable is not configured',
            },
            { status: 500 }
        );
    }

    // Try to get certificate subject from various possible sources in Cloudflare Workers
    const certSubjectHeader = c.req.header('cf-client-cert-subject') ||
        c.req.header('x-client-cert-subject') ||
        c.req.header('client-cert-subject');

    // Also check the cf object for certificate information
    const cfObject = c.req.raw.cf;
    const certSubjectFromCf = cfObject?.tlsClientAuth;

    const certificateSubject = certSubjectHeader || certSubjectFromCf;

    if (!certificateSubject) {
        return c.json(
            {
                success: false,
                error: 'Client certificate required',
                message: 'This endpoint requires mutual TLS authentication',
            },
            { status: 403 }
        );
    }

    if (certificateSubject !== expectedSubject) {
        return c.json(
            {
                success: false,
                error: 'Invalid client certificate',
                message: 'The provided certificate subject does not match the expected value',
                received: certificateSubject,
            },
            { status: 403 }
        );
    }

    // Certificate is valid, proceed to the next handler
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
      SELECT 
        Power as power, 
        strftime('%Y-%m-%d %H:%M:%S', timestamp, 'unixepoch') AS nice_timestamp, 
        TotalYield as total_yield
      FROM PascalsDayData
  order by nice_timestamp desc limit 1;
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
        const result: DayDataRecord[] = [];

        // Today's first value
        const todaysFirstValueSql = `
            SELECT TimeStamp, Serial, Power, TotalYield, LastChangedAt 
            FROM PascalsDayData a 
            INNER JOIN (
                SELECT MIN(TimeStamp) AS FirstTimeStamp 
                FROM PascalsDayData b 
                WHERE TimeStamp >= CAST(strftime('%s','now','start of day') AS INT)
            ) b ON a.TimeStamp = b.FirstTimeStamp;
        `;
        const firstValue = await db.prepare(todaysFirstValueSql).first<DayDataRecord>();
        if (firstValue) {
            result.push(firstValue);
        }

        // Today's max power value
        const todaysMaxValueSql = `
            SELECT a.TimeStamp, a.Serial, a.Power, a.TotalYield, a.LastChangedAt 
            FROM PascalsDayData a 
            INNER JOIN (
                SELECT TimeStamp, MAX(Power) as MaxPower
                FROM PascalsDayData b 
                WHERE TimeStamp >= CAST(strftime('%s','now','start of day') AS INT)
            ) b ON a.TimeStamp = b.TimeStamp;
        `;
        const maxValue = await db.prepare(todaysMaxValueSql).first<DayDataRecord>();
        if (maxValue) {
            result.push(maxValue);
        }

        // Latest value overall
        const latestValueSql = `
            SELECT strftime('%Y-%m-%d %H:%M:%S', timestamp, 'unixepoch') AS nice_timestamp, Serial, Power, TotalYield, LastChangedAt 
            FROM PascalsDayData a 
            INNER JOIN (
                SELECT MAX(TimeStamp) as LatestTimeStamp 
                FROM PascalsDayData b
            ) b ON a.TimeStamp = b.LatestTimeStamp;
        `;
        const latestValue = await db.prepare(latestValueSql).first<DayDataRecord>();
        if (latestValue) {
            result.push(latestValue);
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
app.post('/new_entries', validateClientCertificate, async (c) => {
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
        for (const entry of validEntries) {
            const upsertSql = `
                INSERT INTO PascalsDayData (TimeStamp, Serial, Power, TotalYield, LastChangedAt)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(TimeStamp, Serial) DO UPDATE SET
                    Power = excluded.Power,
                    TotalYield = excluded.TotalYield,
                    LastChangedAt = excluded.LastChangedAt;
            `;

            try {
                await db.prepare(upsertSql).bind(
                    entry.TimeStamp,
                    entry.Serial,
                    entry.Power,
                    entry.TotalYield,
                    entry.LastChangedAt
                ).run();

                results.push({
                    timestamp: entry.TimeStamp,
                    serial: entry.Serial,
                    status: 'inserted_or_updated',
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                results.push({
                    timestamp: entry.TimeStamp,
                    serial: entry.Serial,
                    status: 'failed',
                    error: errorMessage,
                });
            }
        }

        return c.json({
            success: true,
            inserted: validEntries.length,
            results,
            validationErrors: errors.length > 0 ? errors : undefined,
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
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
