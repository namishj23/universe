-- Prefix search ("segmentat" while typing "segmentation") needs the words as written: an
-- English-stemmed vector only holds "segment", which the longer typed prefix can't match. The
-- vector now holds each title and description word both as written ('simple') and stemmed
-- ('english'); queries use 'simple' prefixes. PostgreSQL 17+ changes the expression in place
-- (rewrites the table and its GIN index; no column is dropped).
ALTER TABLE "hub_resources" ALTER COLUMN "search" SET EXPRESSION AS (
  setweight(to_tsvector('simple', "title"), 'A') ||
  setweight(to_tsvector('english', "title"), 'A') ||
  setweight(to_tsvector('simple', "subject"), 'A') ||
  setweight(to_tsvector('simple', coalesce("description", '')), 'B') ||
  setweight(to_tsvector('english', coalesce("description", '')), 'B')
);
