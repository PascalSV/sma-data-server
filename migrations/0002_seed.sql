-- Seed with a recent example row for local dev
INSERT INTO PascalsDayData (TimeStamp, Serial, Power, TotalYield, LastChangedAt)
VALUES (
  CAST(strftime('%s','now') AS INT) - 60,
  'SMA-TEST-001',
  123.45,
  6789.0,
  strftime('%Y-%m-%d %H:%M:%S','now')
);
