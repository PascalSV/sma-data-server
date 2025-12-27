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
}

const app = new Hono<{ Bindings: CloudflareEnv }>();

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
            SELECT TimeStamp, Serial, Power, TotalYield, LastChangedAt 
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

// Catch-all for undefined routes
app.all('*', (c) => {
    return c.json(
        { error: 'Not Found', message: 'The requested endpoint does not exist' },
        { status: 404 }
    );
});

export default app;
