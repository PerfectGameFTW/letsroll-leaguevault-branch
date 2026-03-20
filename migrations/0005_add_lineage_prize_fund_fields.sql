ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "lineage_fee" integer;
ALTER TABLE "leagues" ADD COLUMN IF NOT EXISTS "prize_fund_fee" integer;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "lineage_amount" integer;
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "prize_fund_amount" integer;

UPDATE payments p
SET
  lineage_amount = CASE
    WHEN l.lineage_fee IS NOT NULL AND l.weekly_fee > 0 AND l.lineage_fee <= l.weekly_fee
      THEN ROUND(p.amount::numeric * l.lineage_fee / l.weekly_fee)::integer
    ELSE NULL
  END,
  prize_fund_amount = CASE
    WHEN l.prize_fund_fee IS NOT NULL AND l.weekly_fee > 0 AND l.prize_fund_fee <= l.weekly_fee
      THEN ROUND(p.amount::numeric * l.prize_fund_fee / l.weekly_fee)::integer
    ELSE NULL
  END
FROM leagues l
WHERE p.league_id = l.id
  AND p.lineage_amount IS NULL
  AND p.prize_fund_amount IS NULL;
