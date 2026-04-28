-- Add historic_bill_day to clients
-- When a client's old billing cycle didn't align with the agency cutoff date,
-- the first partial period causes an apparent negative balance.
-- Setting historic_bill_day shifts the effective spend start date to
-- the first occurrence of this day on or after the agency cutoff date.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS historic_bill_day INT CHECK (historic_bill_day BETWEEN 1 AND 31);
