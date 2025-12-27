-- Create table expected by the worker
CREATE TABLE IF NOT EXISTS PascalsDayData (
  TimeStamp INTEGER NOT NULL,
  Serial TEXT NOT NULL,
  Power REAL NOT NULL,
  TotalYield REAL NOT NULL,
  LastChangedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_PascalsDayData_TimeStamp ON PascalsDayData(TimeStamp);
CREATE INDEX IF NOT EXISTS idx_PascalsDayData_Power ON PascalsDayData(Power);
