-- Speeds up the "reuse a past drawing" lookup, which filters JobAttachment by kind.
CREATE INDEX IF NOT EXISTS "JobAttachment_kind_idx" ON "JobAttachment"("kind");
