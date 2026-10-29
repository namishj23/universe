-- Second half of additive-then-drop: login throttling moved to "login_throttle"
-- (20261029160836_p2_platform_services). Lock state is short-lived (15 minutes) and keyed by
-- an HMAC that needs the application secret, so active locks are not copied across.
ALTER TABLE "users" DROP COLUMN "failed_login_count",
DROP COLUMN "locked_until";
