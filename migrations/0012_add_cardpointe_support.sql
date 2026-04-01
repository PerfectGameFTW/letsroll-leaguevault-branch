ALTER TABLE locations ADD COLUMN IF NOT EXISTS cardpointe_credentials jsonb;
ALTER TABLE bowlers ADD COLUMN IF NOT EXISTS cardpointe_profile_id text;
