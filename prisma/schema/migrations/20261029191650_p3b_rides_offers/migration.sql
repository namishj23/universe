-- P3b: carpool drivers and offers, edge modes and durations (hand-edited: backfill + CHECKs).
-- AlterTable
ALTER TABLE "rides_drivers" ADD COLUMN     "review_note" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMPTZ(3),
ADD COLUMN     "reviewed_by_id" UUID,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'approved';

-- AlterTable
ALTER TABLE "rides_route_edges" ADD COLUMN     "duration_s" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "estimated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'road';

-- AlterTable
ALTER TABLE "rides_vehicles" ADD COLUMN     "vehicle_type" TEXT NOT NULL DEFAULT 'auto',
ALTER COLUMN "permit_expires_at" DROP NOT NULL,
ALTER COLUMN "fitness_expires_at" DROP NOT NULL,
ALTER COLUMN "last_service_at" DROP NOT NULL;

-- CreateTable
CREATE TABLE "rides_offers" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "origin_node_id" UUID NOT NULL,
    "dest_node_id" UUID NOT NULL,
    "depart_at" TIMESTAMPTZ(3) NOT NULL,
    "seats" INTEGER NOT NULL,
    "max_detour_m" INTEGER NOT NULL,
    "max_detour_s" INTEGER NOT NULL,
    "cost_per_km_paise" INTEGER NOT NULL,
    "auto_accept" BOOLEAN NOT NULL DEFAULT false,
    "women_only" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'open',
    "base_path" UUID[],
    "base_distance_m" INTEGER NOT NULL,
    "base_duration_s" INTEGER NOT NULL,
    "plan" JSONB NOT NULL DEFAULT '[]',
    "plan_distance_m" INTEGER NOT NULL,
    "plan_duration_s" INTEGER NOT NULL,
    "peak_onboard" INTEGER NOT NULL DEFAULT 0,
    "trip_cost_paise" INTEGER NOT NULL,
    "driver_share_paise" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "cancelled_at" TIMESTAMPTZ(3),
    "departed_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "rides_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rides_offer_bookings" (
    "id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "pickup_node_id" UUID NOT NULL,
    "drop_node_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "added_detour_m" INTEGER NOT NULL DEFAULT 0,
    "planned_pickup_at" TIMESTAMPTZ(3) NOT NULL,
    "in_vehicle_m" INTEGER NOT NULL DEFAULT 0,
    "direct_m" INTEGER NOT NULL,
    "cost_share_paise" INTEGER NOT NULL DEFAULT 0,
    "solo_fare_paise" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),

    CONSTRAINT "rides_offer_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rides_offers_status_depart_at_idx" ON "rides_offers"("status", "depart_at");

-- CreateIndex
CREATE INDEX "rides_offers_driver_id_depart_at_id_idx" ON "rides_offers"("driver_id", "depart_at", "id");

-- CreateIndex
CREATE INDEX "rides_offers_vehicle_id_idx" ON "rides_offers"("vehicle_id");

-- CreateIndex
CREATE INDEX "rides_offers_origin_node_id_idx" ON "rides_offers"("origin_node_id");

-- CreateIndex
CREATE INDEX "rides_offers_dest_node_id_idx" ON "rides_offers"("dest_node_id");

-- CreateIndex
CREATE INDEX "rides_offer_bookings_offer_id_status_idx" ON "rides_offer_bookings"("offer_id", "status");

-- CreateIndex
CREATE INDEX "rides_offer_bookings_passenger_id_status_planned_pickup_at_idx" ON "rides_offer_bookings"("passenger_id", "status", "planned_pickup_at");

-- CreateIndex
CREATE INDEX "rides_offer_bookings_request_id_idx" ON "rides_offer_bookings"("request_id");

-- CreateIndex
CREATE INDEX "rides_offer_bookings_pickup_node_id_idx" ON "rides_offer_bookings"("pickup_node_id");

-- CreateIndex
CREATE INDEX "rides_offer_bookings_drop_node_id_idx" ON "rides_offer_bookings"("drop_node_id");

-- CreateIndex
CREATE UNIQUE INDEX "rides_offer_bookings_offer_id_passenger_id_key" ON "rides_offer_bookings"("offer_id", "passenger_id");

-- CreateIndex
CREATE INDEX "rides_drivers_kind_status_idx" ON "rides_drivers"("kind", "status");

-- CreateIndex
CREATE INDEX "rides_drivers_reviewed_by_id_idx" ON "rides_drivers"("reviewed_by_id");

-- CreateIndex
CREATE INDEX "rides_vehicles_vehicle_type_created_at_id_idx" ON "rides_vehicles"("vehicle_type", "created_at", "id");

-- AddForeignKey
ALTER TABLE "rides_drivers" ADD CONSTRAINT "rides_drivers_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "rides_profiles"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_offers" ADD CONSTRAINT "rides_offers_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "rides_drivers"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_offers" ADD CONSTRAINT "rides_offers_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "rides_vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_offers" ADD CONSTRAINT "rides_offers_origin_node_id_fkey" FOREIGN KEY ("origin_node_id") REFERENCES "rides_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_offers" ADD CONSTRAINT "rides_offers_dest_node_id_fkey" FOREIGN KEY ("dest_node_id") REFERENCES "rides_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_offer_bookings" ADD CONSTRAINT "rides_offer_bookings_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "rides_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_offer_bookings" ADD CONSTRAINT "rides_offer_bookings_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "rides_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_offer_bookings" ADD CONSTRAINT "rides_offer_bookings_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "rides_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_offer_bookings" ADD CONSTRAINT "rides_offer_bookings_pickup_node_id_fkey" FOREIGN KEY ("pickup_node_id") REFERENCES "rides_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides_offer_bookings" ADD CONSTRAINT "rides_offer_bookings_drop_node_id_fkey" FOREIGN KEY ("drop_node_id") REFERENCES "rides_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing edges are roads: duration at 20 km/h (config graph.speedKmh.road); the seed rewrites them.
UPDATE "rides_route_edges" SET "duration_s" = GREATEST(1, round("distance_m" * 3.6 / 20));
ALTER TABLE "rides_route_edges" ALTER COLUMN "duration_s" DROP DEFAULT;

ALTER TABLE "rides_route_edges"
  ADD CONSTRAINT "rides_route_edges_mode_check" CHECK ("mode" IN ('road', 'campus_road', 'walk')),
  ADD CONSTRAINT "rides_route_edges_duration_check" CHECK ("duration_s" > 0);

ALTER TABLE "rides_vehicles"
  ADD CONSTRAINT "rides_vehicles_type_check" CHECK ("vehicle_type" IN ('auto', 'car', 'bike')),
  ADD CONSTRAINT "rides_vehicles_auto_fields_check" CHECK ("vehicle_type" <> 'auto' OR
    ("permit_expires_at" IS NOT NULL AND "fitness_expires_at" IS NOT NULL AND "last_service_at" IS NOT NULL)),
  ADD CONSTRAINT "rides_vehicles_bike_seats_check" CHECK ("vehicle_type" <> 'bike' OR "seats" = 1);

ALTER TABLE "rides_drivers" DROP CONSTRAINT "rides_drivers_kind_check";
ALTER TABLE "rides_drivers"
  ADD CONSTRAINT "rides_drivers_kind_check" CHECK ("kind" IN ('auto', 'carpool')),
  ADD CONSTRAINT "rides_drivers_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected', 'suspended'));

ALTER TABLE "rides_offers"
  ADD CONSTRAINT "rides_offers_status_check" CHECK ("status" IN ('open', 'full', 'departed', 'completed', 'cancelled')),
  ADD CONSTRAINT "rides_offers_ends_diff" CHECK ("origin_node_id" <> "dest_node_id"),
  ADD CONSTRAINT "rides_offers_seats_check" CHECK ("seats" BETWEEN 1 AND 6 AND "peak_onboard" BETWEEN 0 AND "seats"),
  ADD CONSTRAINT "rides_offers_detour_check" CHECK ("max_detour_m" BETWEEN 0 AND 10000 AND "max_detour_s" BETWEEN 0 AND 3600),
  ADD CONSTRAINT "rides_offers_amounts_check" CHECK ("cost_per_km_paise" >= 0 AND "base_distance_m" > 0 AND "base_duration_s" > 0
    AND "plan_distance_m" >= "base_distance_m" AND "plan_duration_s" >= 0 AND "trip_cost_paise" >= 0 AND "driver_share_paise" >= 0);

ALTER TABLE "rides_offer_bookings"
  ADD CONSTRAINT "rides_offer_bookings_status_check" CHECK ("status" IN ('requested', 'accepted', 'declined', 'cancelled')),
  ADD CONSTRAINT "rides_offer_bookings_ends_diff" CHECK ("pickup_node_id" <> "drop_node_id"),
  ADD CONSTRAINT "rides_offer_bookings_amounts_check" CHECK ("added_detour_m" >= 0 AND "in_vehicle_m" >= 0 AND "direct_m" > 0
    AND "cost_share_paise" >= 0 AND "solo_fare_paise" >= 0);
