-- Prisma's migration connection pins search_path to the datasource schema (public); PostGIS and
-- btree_gist live in schema extensions (see the P1 decision), so add it for this script.
SET search_path TO public, extensions;

-- CreateTable
CREATE TABLE "rides_profiles" (
    "user_id" UUID NOT NULL,
    "rider_code" TEXT NOT NULL,
    "gender" TEXT,
    "women_only_groups" BOOLEAN NOT NULL DEFAULT false,
    "driver_preference" TEXT NOT NULL DEFAULT 'any',
    "suspended_at" TIMESTAMPTZ(3),
    "suspended_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rides_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "rides_nodes" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "aliases" TEXT[],
    "geom" geography(Point, 4326) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rides_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rides_route_edges" (
    "id" UUID NOT NULL,
    "node_a_id" UUID NOT NULL,
    "node_b_id" UUID NOT NULL,
    "distance_m" INTEGER NOT NULL,

    CONSTRAINT "rides_route_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rides_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "pickup_node_id" UUID NOT NULL,
    "drop_node_id" UUID NOT NULL,
    "pickup_at" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "distance_m" INTEGER NOT NULL,
    "solo_fare_paise" INTEGER NOT NULL,
    "group_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rides_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rides_groups" (
    "id" UUID NOT NULL,
    "pickup_node_id" UUID NOT NULL,
    "pickup_at" TIMESTAMPTZ(3) NOT NULL,
    "total_fare_paise" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'forming',
    "kind" TEXT NOT NULL DEFAULT 'auto',
    "women_only" BOOLEAN NOT NULL DEFAULT false,
    "meeting_point" TEXT,
    "transit_mode" TEXT,
    "vehicle_id" UUID,
    "driver_assigned_at" TIMESTAMPTZ(3),
    "eta_minutes" INTEGER,
    "driver_female_requested" BOOLEAN NOT NULL DEFAULT false,
    "driver_accepted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rides_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rides_group_members" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "drop_node_id" UUID NOT NULL,
    "fare_share_paise" INTEGER NOT NULL DEFAULT 0,
    "boarded_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "payment_method" TEXT,
    "allow_any_driver" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rides_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rides_chat_messages" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rides_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rides_vehicles" (
    "id" UUID NOT NULL,
    "plate_number" TEXT NOT NULL,
    "registration_number" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "colour" TEXT,
    "seats" INTEGER NOT NULL DEFAULT 3,
    "permit_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "insurance_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "puc_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "fitness_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "documents_status" TEXT NOT NULL DEFAULT 'approved',
    "status" TEXT NOT NULL DEFAULT 'active',
    "flagged_reason" TEXT,
    "last_service_at" TIMESTAMPTZ(3) NOT NULL,
    "last_service_m" INTEGER NOT NULL DEFAULT 0,
    "driven_m" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rides_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rides_vehicle_inspections" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "tyres_file_id" UUID NOT NULL,
    "lights_file_id" UUID NOT NULL,
    "seats_file_id" UUID NOT NULL,
    "meter_file_id" UUID NOT NULL,
    "submitted_by_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "note" TEXT,

    CONSTRAINT "rides_vehicle_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rides_vehicle_feedback" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "cleanliness" INTEGER NOT NULL,
    "condition" INTEGER NOT NULL,
    "tags" TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rides_vehicle_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rides_safety_reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "about_user_id" UUID,
    "about_vehicle_id" UUID,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rides_safety_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rides_notices" (
    "id" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "created_by_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rides_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rides_drivers" (
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'auto',
    "vehicle_id" UUID,
    "driver_code" TEXT NOT NULL,
    "gender" TEXT,
    "online" BOOLEAN NOT NULL DEFAULT false,
    "rating_tenths" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rides_drivers_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "rides_driver_documents" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "file_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "note" TEXT,

    CONSTRAINT "rides_driver_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rides_driver_trips" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "status" TEXT NOT NULL,
    "declined_at" TIMESTAMPTZ(3),
    "accepted_at" TIMESTAMPTZ(3),
    "heading_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rides_driver_trips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rides_profiles_rider_code_key" ON "rides_profiles"("rider_code");

-- CreateIndex
CREATE INDEX "rides_profiles_created_at_user_id_idx" ON "rides_profiles"("created_at" DESC, "user_id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "rides_nodes_name_key" ON "rides_nodes"("name");

-- CreateIndex
CREATE INDEX "rides_nodes_geom_idx" ON "rides_nodes" USING GIST ("geom");

-- CreateIndex
CREATE INDEX "rides_route_edges_node_b_id_idx" ON "rides_route_edges"("node_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "rides_route_edges_node_a_id_node_b_id_key" ON "rides_route_edges"("node_a_id", "node_b_id");

-- CreateIndex
CREATE INDEX "rides_requests_user_id_status_idx" ON "rides_requests"("user_id", "status");

-- CreateIndex
CREATE INDEX "rides_requests_pickup_node_id_status_pickup_at_idx" ON "rides_requests"("pickup_node_id", "status", "pickup_at");

-- CreateIndex
CREATE INDEX "rides_requests_drop_node_id_idx" ON "rides_requests"("drop_node_id");

-- CreateIndex
CREATE INDEX "rides_requests_group_id_idx" ON "rides_requests"("group_id");

-- CreateIndex
CREATE INDEX "rides_requests_status_pickup_at_idx" ON "rides_requests"("status", "pickup_at");

-- CreateIndex
CREATE INDEX "rides_groups_status_pickup_at_id_idx" ON "rides_groups"("status", "pickup_at", "id");

-- CreateIndex
CREATE INDEX "rides_groups_pickup_node_id_status_idx" ON "rides_groups"("pickup_node_id", "status");

-- CreateIndex
CREATE INDEX "rides_groups_vehicle_id_idx" ON "rides_groups"("vehicle_id");

-- CreateIndex
CREATE INDEX "rides_groups_pickup_at_id_idx" ON "rides_groups"("pickup_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "rides_group_members_request_id_key" ON "rides_group_members"("request_id");

-- CreateIndex
CREATE INDEX "rides_group_members_user_id_joined_at_idx" ON "rides_group_members"("user_id", "joined_at");

-- CreateIndex
CREATE INDEX "rides_group_members_drop_node_id_idx" ON "rides_group_members"("drop_node_id");

-- CreateIndex
CREATE UNIQUE INDEX "rides_group_members_group_id_user_id_key" ON "rides_group_members"("group_id", "user_id");

-- CreateIndex
CREATE INDEX "rides_chat_messages_group_id_created_at_id_idx" ON "rides_chat_messages"("group_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "rides_chat_messages_user_id_idx" ON "rides_chat_messages"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "rides_vehicles_plate_number_key" ON "rides_vehicles"("plate_number");

-- CreateIndex
CREATE INDEX "rides_vehicles_created_at_id_idx" ON "rides_vehicles"("created_at", "id");

-- CreateIndex
CREATE INDEX "rides_vehicle_inspections_vehicle_id_submitted_at_idx" ON "rides_vehicle_inspections"("vehicle_id", "submitted_at" DESC);

-- CreateIndex
CREATE INDEX "rides_vehicle_inspections_status_submitted_at_idx" ON "rides_vehicle_inspections"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "rides_vehicle_inspections_submitted_by_id_idx" ON "rides_vehicle_inspections"("submitted_by_id");

-- CreateIndex
CREATE INDEX "rides_vehicle_inspections_reviewed_by_id_idx" ON "rides_vehicle_inspections"("reviewed_by_id");

-- CreateIndex
CREATE INDEX "rides_vehicle_feedback_vehicle_id_created_at_idx" ON "rides_vehicle_feedback"("vehicle_id", "created_at");

-- CreateIndex
CREATE INDEX "rides_vehicle_feedback_user_id_idx" ON "rides_vehicle_feedback"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "rides_vehicle_feedback_group_id_user_id_key" ON "rides_vehicle_feedback"("group_id", "user_id");

-- CreateIndex
CREATE INDEX "rides_safety_reports_created_at_id_idx" ON "rides_safety_reports"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "rides_safety_reports_reporter_id_idx" ON "rides_safety_reports"("reporter_id");

-- CreateIndex
CREATE INDEX "rides_safety_reports_group_id_idx" ON "rides_safety_reports"("group_id");

-- CreateIndex
CREATE INDEX "rides_safety_reports_about_user_id_idx" ON "rides_safety_reports"("about_user_id");

-- CreateIndex
CREATE INDEX "rides_safety_reports_about_vehicle_id_idx" ON "rides_safety_reports"("about_vehicle_id");

-- CreateIndex
CREATE INDEX "rides_safety_reports_resolved_by_id_idx" ON "rides_safety_reports"("resolved_by_id");

-- CreateIndex
CREATE INDEX "rides_notices_created_at_id_idx" ON "rides_notices"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "rides_notices_created_by_id_idx" ON "rides_notices"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "rides_drivers_vehicle_id_key" ON "rides_drivers"("vehicle_id");

-- CreateIndex
CREATE UNIQUE INDEX "rides_drivers_driver_code_key" ON "rides_drivers"("driver_code");

-- CreateIndex
CREATE INDEX "rides_drivers_online_idx" ON "rides_drivers"("online");

-- CreateIndex
CREATE INDEX "rides_drivers_created_at_user_id_idx" ON "rides_drivers"("created_at", "user_id");

-- CreateIndex
CREATE INDEX "rides_driver_documents_driver_id_uploaded_at_idx" ON "rides_driver_documents"("driver_id", "uploaded_at" DESC);

-- CreateIndex
CREATE INDEX "rides_driver_documents_status_idx" ON "rides_driver_documents"("status");

-- CreateIndex
CREATE INDEX "rides_driver_documents_reviewed_by_id_idx" ON "rides_driver_documents"("reviewed_by_id");

-- CreateIndex
CREATE INDEX "rides_driver_trips_driver_id_status_idx" ON "rides_driver_trips"("driver_id", "status");

-- CreateIndex
CREATE INDEX "rides_driver_trips_vehicle_id_idx" ON "rides_driver_trips"("vehicle_id");

-- CreateIndex
CREATE UNIQUE INDEX "rides_driver_trips_group_id_driver_id_key" ON "rides_driver_trips"("group_id", "driver_id");

-- AddForeignKey
ALTER TABLE "rides_profiles" ADD CONSTRAINT "rides_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_route_edges" ADD CONSTRAINT "rides_route_edges_node_a_id_fkey" FOREIGN KEY ("node_a_id") REFERENCES "rides_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_route_edges" ADD CONSTRAINT "rides_route_edges_node_b_id_fkey" FOREIGN KEY ("node_b_id") REFERENCES "rides_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_requests" ADD CONSTRAINT "rides_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "rides_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_requests" ADD CONSTRAINT "rides_requests_pickup_node_id_fkey" FOREIGN KEY ("pickup_node_id") REFERENCES "rides_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_requests" ADD CONSTRAINT "rides_requests_drop_node_id_fkey" FOREIGN KEY ("drop_node_id") REFERENCES "rides_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_requests" ADD CONSTRAINT "rides_requests_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "rides_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_groups" ADD CONSTRAINT "rides_groups_pickup_node_id_fkey" FOREIGN KEY ("pickup_node_id") REFERENCES "rides_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_groups" ADD CONSTRAINT "rides_groups_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "rides_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_group_members" ADD CONSTRAINT "rides_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "rides_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_group_members" ADD CONSTRAINT "rides_group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "rides_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_group_members" ADD CONSTRAINT "rides_group_members_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "rides_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_group_members" ADD CONSTRAINT "rides_group_members_drop_node_id_fkey" FOREIGN KEY ("drop_node_id") REFERENCES "rides_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_chat_messages" ADD CONSTRAINT "rides_chat_messages_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "rides_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_chat_messages" ADD CONSTRAINT "rides_chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "rides_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_vehicle_inspections" ADD CONSTRAINT "rides_vehicle_inspections_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "rides_vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_vehicle_inspections" ADD CONSTRAINT "rides_vehicle_inspections_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "rides_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_vehicle_inspections" ADD CONSTRAINT "rides_vehicle_inspections_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "rides_profiles"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_vehicle_feedback" ADD CONSTRAINT "rides_vehicle_feedback_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "rides_vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_vehicle_feedback" ADD CONSTRAINT "rides_vehicle_feedback_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "rides_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_vehicle_feedback" ADD CONSTRAINT "rides_vehicle_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "rides_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_safety_reports" ADD CONSTRAINT "rides_safety_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "rides_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_safety_reports" ADD CONSTRAINT "rides_safety_reports_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "rides_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_safety_reports" ADD CONSTRAINT "rides_safety_reports_about_user_id_fkey" FOREIGN KEY ("about_user_id") REFERENCES "rides_profiles"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_safety_reports" ADD CONSTRAINT "rides_safety_reports_about_vehicle_id_fkey" FOREIGN KEY ("about_vehicle_id") REFERENCES "rides_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_safety_reports" ADD CONSTRAINT "rides_safety_reports_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "rides_profiles"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_notices" ADD CONSTRAINT "rides_notices_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "rides_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_drivers" ADD CONSTRAINT "rides_drivers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_drivers" ADD CONSTRAINT "rides_drivers_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "rides_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_driver_documents" ADD CONSTRAINT "rides_driver_documents_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "rides_drivers"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_driver_documents" ADD CONSTRAINT "rides_driver_documents_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "rides_profiles"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_driver_trips" ADD CONSTRAINT "rides_driver_trips_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "rides_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_driver_trips" ADD CONSTRAINT "rides_driver_trips_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "rides_drivers"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_driver_trips" ADD CONSTRAINT "rides_driver_trips_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "rides_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Hand-written: constraints Prisma's schema language cannot express ─────────────────────

-- Enum-like text columns.
ALTER TABLE "rides_profiles"
  ADD CONSTRAINT "rides_profiles_rider_code_check" CHECK ("rider_code" ~ '^[0-9]{6}$'),
  ADD CONSTRAINT "rides_profiles_gender_check" CHECK ("gender" IN ('female', 'male', 'non_binary')),
  ADD CONSTRAINT "rides_profiles_driver_preference_check" CHECK ("driver_preference" IN ('any', 'female')),
  ADD CONSTRAINT "rides_profiles_women_only_check" CHECK (NOT "women_only_groups" OR "gender" = 'female');
ALTER TABLE "rides_nodes"
  ADD CONSTRAINT "rides_nodes_area_check" CHECK ("area" IN ('campus', 'city'));
ALTER TABLE "rides_route_edges"
  ADD CONSTRAINT "rides_route_edges_not_self" CHECK ("node_a_id" <> "node_b_id"),
  ADD CONSTRAINT "rides_route_edges_distance_check" CHECK ("distance_m" > 0);
ALTER TABLE "rides_requests"
  ADD CONSTRAINT "rides_requests_status_check" CHECK ("status" IN ('open', 'matched', 'completed', 'cancelled')),
  ADD CONSTRAINT "rides_requests_pickup_drop_diff" CHECK ("pickup_node_id" <> "drop_node_id"),
  ADD CONSTRAINT "rides_requests_amounts_check" CHECK ("distance_m" > 0 AND "solo_fare_paise" >= 0);
ALTER TABLE "rides_groups"
  ADD CONSTRAINT "rides_groups_status_check" CHECK ("status" IN ('forming', 'confirmed', 'completed', 'cancelled')),
  ADD CONSTRAINT "rides_groups_kind_check" CHECK ("kind" IN ('auto', 'transit')),
  ADD CONSTRAINT "rides_groups_transit_mode_check" CHECK ("transit_mode" IN ('bus', 'train', 'metro', 'walk', 'other')),
  ADD CONSTRAINT "rides_groups_fare_check" CHECK ("total_fare_paise" >= 0),
  ADD CONSTRAINT "rides_groups_driver_fields_check" CHECK (("vehicle_id" IS NULL) = ("driver_assigned_at" IS NULL)),
  ADD CONSTRAINT "rides_groups_accept_check" CHECK ("driver_accepted_at" IS NULL OR "vehicle_id" IS NOT NULL);
ALTER TABLE "rides_group_members"
  ADD CONSTRAINT "rides_group_members_fare_check" CHECK ("fare_share_paise" >= 0),
  ADD CONSTRAINT "rides_group_members_payment_check" CHECK ("payment_method" IN ('upi', 'wallet', 'card', 'cash'));
ALTER TABLE "rides_vehicles"
  ADD CONSTRAINT "rides_vehicles_documents_status_check" CHECK ("documents_status" IN ('approved', 'pending', 'rejected')),
  ADD CONSTRAINT "rides_vehicles_status_check" CHECK ("status" IN ('active', 'suspended')),
  ADD CONSTRAINT "rides_vehicles_distance_check" CHECK ("driven_m" >= 0 AND "last_service_m" >= 0 AND "last_service_m" <= "driven_m"),
  ADD CONSTRAINT "rides_vehicles_seats_check" CHECK ("seats" BETWEEN 1 AND 6);
ALTER TABLE "rides_vehicle_inspections"
  ADD CONSTRAINT "rides_vehicle_inspections_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected'));
ALTER TABLE "rides_vehicle_feedback"
  ADD CONSTRAINT "rides_vehicle_feedback_scores_check" CHECK ("cleanliness" BETWEEN 1 AND 5 AND "condition" BETWEEN 1 AND 5);
ALTER TABLE "rides_safety_reports"
  ADD CONSTRAINT "rides_safety_reports_category_check" CHECK ("category" IN ('unsafe driving', 'harassment', 'no show', 'payment issue', 'other')),
  ADD CONSTRAINT "rides_safety_reports_status_check" CHECK ("status" IN ('open', 'resolved', 'dismissed'));
ALTER TABLE "rides_notices"
  ADD CONSTRAINT "rides_notices_level_check" CHECK ("level" IN ('info', 'warning'));
ALTER TABLE "rides_drivers"
  ADD CONSTRAINT "rides_drivers_kind_check" CHECK ("kind" IN ('auto')),
  ADD CONSTRAINT "rides_drivers_gender_check" CHECK ("gender" IN ('female', 'male', 'non_binary')),
  ADD CONSTRAINT "rides_drivers_rating_check" CHECK ("rating_tenths" BETWEEN 0 AND 50);
ALTER TABLE "rides_driver_documents"
  ADD CONSTRAINT "rides_driver_documents_type_check" CHECK ("type" IN ('licence', 'inspection_certificate')),
  ADD CONSTRAINT "rides_driver_documents_status_check" CHECK ("status" IN ('pending', 'verified', 'rejected'));
ALTER TABLE "rides_driver_trips"
  ADD CONSTRAINT "rides_driver_trips_status_check" CHECK ("status" IN ('declined', 'accepted', 'heading', 'started', 'completed'));

-- A vehicle is busy from its assignment until 30 minutes after that group's pickup (Module B's
-- DRIVER_BUSY_AFTER_PICKUP_MINUTES, config.drivers.busyAfterPickupMinutes). Two live
-- assignments of one vehicle with overlapping busy periods are impossible, whatever the
-- application does. A time-based rule cannot be a partial unique index (now() is not
-- immutable), so this is an exclusion constraint; btree_gist provides uuid equality in GiST.
-- timestamptz + interval is only STABLE in general (day/month steps depend on the time zone);
-- adding minutes is not, so this wrapper is declared IMMUTABLE for use in the constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist SCHEMA extensions;
CREATE FUNCTION "rides_vehicle_busy_until"(pickup timestamptz) RETURNS timestamptz
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT pickup + interval '30 minutes' $$;
ALTER TABLE "rides_groups"
  ADD CONSTRAINT "rides_groups_vehicle_busy" EXCLUDE USING gist (
    "vehicle_id" WITH =,
    tstzrange("driver_assigned_at", "rides_vehicle_busy_until"("pickup_at")) WITH &&
  ) WHERE ("vehicle_id" IS NOT NULL AND "status" <> 'cancelled');
