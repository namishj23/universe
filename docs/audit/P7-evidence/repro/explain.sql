-- P7 check 9: EXPLAIN (ANALYZE) of the main list and search queries at realistic volume.
-- universe_test only, everything inside one transaction that is rolled back:
--   psql -d universe_test -v ON_ERROR_STOP=1 -f docs/audit/P7-evidence/repro/explain.sql
-- Synthetic rows skip FK triggers (session_replication_role = replica, local to this transaction).
-- The query shapes copy the code: Prisma's generated SQL for feed/users/audit, the raw SQL for
-- resources search (resources.ts:89) and offer matching (offers.js:947).
\set ON_ERROR_STOP 1
BEGIN;
SET LOCAL session_replication_role = replica;
SET LOCAL search_path TO public, extensions;

-- 20,000 users (names searchable), one probe user P.
INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
SELECT gen_random_uuid(), 'synthetic' || g || '@x.test', 'Student ' || md5(g::text), 'x',
       (ARRAY['student','student','student','mentor','driver']::role[])[1 + g % 5],
       now() - g * interval '1 minute', now()
FROM generate_series(1, 20000) g;
INSERT INTO users (id, email, name, password_hash, role, updated_at)
VALUES ('11111111-1111-4111-8111-111111111111', 'probe@x.test', 'Probe User', 'x', 'student', now());

-- 300,000 activity events over 2,000 recipients (150 each), P gets 150.
INSERT INTO activity_events (id, recipient_id, module, type, payload, created_at, read_at)
SELECT gen_random_uuid(),
       CASE WHEN g % 2000 = 0 THEN '11111111-1111-4111-8111-111111111111'::uuid
            ELSE (SELECT id FROM users WHERE email = 'synthetic' || (g % 2000) || '@x.test') END,
       'platform', 'platform.announcement', '{"message":"x"}', now() - g * interval '1 second',
       CASE WHEN g % 3 = 0 THEN now() END
FROM generate_series(1, 300000) g;

-- 300,000 audit entries over 10 action families.
INSERT INTO audit_log (id, actor_id, action, target_type, target_id, metadata, created_at)
SELECT gen_random_uuid(), NULL,
       (ARRAY['auth.login','auth.login_failed','rides.ride_cancelled','hub.resource_deleted','admin.user_updated'])[1 + g % 5],
       'user', md5(g::text), '{}', now() - g * interval '1 second'
FROM generate_series(1, 300000) g;

-- 365 days x 5 categories for 1,000 users (P included) = 1.8 M wellbeing rows.
INSERT INTO wb_daily_totals (user_id, date, category, minutes, updated_at)
SELECT u.id, current_date - d, c, (d * 7) % 300, now()
FROM ((SELECT id FROM users WHERE email LIKE 'synthetic%' LIMIT 999)
      UNION ALL SELECT '11111111-1111-4111-8111-111111111111'::uuid) u
CROSS JOIN generate_series(0, 364) d
CROSS JOIN unnest(ARRAY['study','communication','social','entertainment','other']) c;

-- 20,000 hub resources by 2,000 uploaders.
INSERT INTO hub_resources (id, file_id, title, description, subject, type, uploader_id, created_at)
SELECT gen_random_uuid(), gen_random_uuid(),
       (ARRAY['Operating systems notes','DBMS question paper','Computer networks lab','Dynamic programming sheet'])[1 + g % 4] || ' ' || g,
       'Unit ' || (g % 6) || ' study material', (ARRAY['OS','DBMS','CN','DSA'])[1 + g % 4], 'notes',
       (SELECT id FROM users WHERE email = 'synthetic' || (g % 2000 + 1) || '@x.test'),
       now() - g * interval '1 minute'
FROM generate_series(1, 20000) g;

-- 20,000 carpool offers over 60 days, about 200 open around tomorrow 09:00.
INSERT INTO rides_offers (id, driver_id, vehicle_id, origin_node_id, dest_node_id, depart_at, seats,
  max_detour_m, max_detour_s, cost_per_km_paise, status, base_distance_m, base_duration_s,
  plan_distance_m, plan_duration_s, trip_cost_paise, driver_share_paise, updated_at)
SELECT gen_random_uuid(), (SELECT id FROM users WHERE email = 'synthetic' || (g % 500 + 1) || '@x.test'),
       gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
       date_trunc('day', now()) + interval '1 day 9 hours' + ((g % 20000) - 10000) * interval '4 minutes' ,
       3, 3000, 600, 900, CASE WHEN g % 10 = 0 THEN 'completed' ELSE 'open' END, 10000, 1200, 10000, 1200, 9000, 3000, now()
FROM generate_series(1, 20000) g;

ANALYZE users; ANALYZE activity_events; ANALYZE audit_log; ANALYZE wb_daily_totals; ANALYZE hub_resources; ANALYZE rides_offers;

\echo '### 1. Activity feed, first page (activity/routes.ts GET /)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM activity_events WHERE recipient_id = '11111111-1111-4111-8111-111111111111'
ORDER BY created_at DESC, id DESC LIMIT 21;

\echo '### 2. Unread count (dashboard, bell)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT count(*) FROM activity_events WHERE recipient_id = '11111111-1111-4111-8111-111111111111' AND read_at IS NULL;

\echo '### 3. Admin users search q=probe (admin/users.ts ILIKE on name OR email)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM users WHERE (name ILIKE '%probe%' OR email ILIKE '%probe%')
ORDER BY created_at DESC, id DESC LIMIT 21;

\echo '### 4. Admin users, role filter, page 1'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM users WHERE role = 'mentor' ORDER BY created_at DESC, id DESC LIMIT 21;

\echo '### 5. Audit list, actionPrefix=rides (startsWith)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM audit_log WHERE action LIKE 'rides.%' ORDER BY created_at DESC, id DESC LIMIT 21;

\echo '### 6. Audit list, targetId only'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM audit_log WHERE target_id = md5('4242') ORDER BY created_at DESC, id DESC LIMIT 21;

\echo '### 7. Wellbeing summary window, 31 days (service.ts)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT date, category, minutes FROM wb_daily_totals
WHERE user_id = '11111111-1111-4111-8111-111111111111' AND date BETWEEN current_date - 30 AND current_date;

\echo '### 8. Wellbeing records page (date desc)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT * FROM wb_daily_totals WHERE user_id = '11111111-1111-4111-8111-111111111111'
ORDER BY date DESC, category DESC LIMIT 21;

\echo '### 9. Hub resources search q=dynamic (resources.ts:89, full text + uploader name)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
WITH hits AS (
  SELECT r.id, ts_rank(r.search, to_tsquery('simple', 'dynamic:*'))::float8 AS rank
  FROM hub_resources r WHERE r.search @@ to_tsquery('simple', 'dynamic:*')
  UNION ALL
  SELECT r.id, 0::float8 FROM users u JOIN hub_resources r ON r.uploader_id = u.id WHERE u.name ILIKE '%dynamic%'
), ranked AS (SELECT id, max(rank) AS rank FROM hits GROUP BY id)
SELECT r.id, r.title, u.name, h.rank FROM ranked h JOIN hub_resources r ON r.id = h.id
JOIN users u ON u.id = r.uploader_id LEFT JOIN files f ON f.id = r.file_id
WHERE r.deleted_at IS NULL ORDER BY h.rank DESC, r.created_at DESC, r.id DESC LIMIT 21;

\echo '### 10. Hub resources list, subject filter, no q'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT r.id FROM hub_resources r JOIN users u ON u.id = r.uploader_id LEFT JOIN files f ON f.id = r.file_id
WHERE r.deleted_at IS NULL AND r.subject = 'OS' ORDER BY r.created_at DESC, r.id DESC LIMIT 21;

\echo '### 11. Offer matching candidate window (offers.js:947)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT o.id FROM rides_offers o LEFT JOIN rides_profiles dp ON dp.user_id = o.driver_id
WHERE o.status IN ('open','full')
  AND o.depart_at BETWEEN date_trunc('day', now()) + interval '1 day 9 hours' - interval '150 minutes'
                      AND date_trunc('day', now()) + interval '1 day 9 hours' + interval '30 minutes'
  AND o.depart_at + make_interval(secs => o.base_duration_s + o.max_detour_s) >= date_trunc('day', now()) + interval '1 day 8 hours 30 minutes'
  AND o.driver_id <> '11111111-1111-4111-8111-111111111111'
  AND NOT EXISTS (SELECT 1 FROM rides_offer_bookings b WHERE b.offer_id = o.id
                  AND b.passenger_id = '11111111-1111-4111-8111-111111111111' AND b.status IN ('requested','accepted','declined'));

\echo '### 12. Dead-session cleanup (sessions.ts deleteDeadSessions)'
EXPLAIN (COSTS OFF)
DELETE FROM sessions WHERE expires_at <= now() OR last_seen_at <= now() - interval '2 hours';

ROLLBACK;
