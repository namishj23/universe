-- P7-003: an admin cancel or unassign closes the driver's live trip.
ALTER TABLE "rides_driver_trips" DROP CONSTRAINT "rides_driver_trips_status_check";
ALTER TABLE "rides_driver_trips"
  ADD CONSTRAINT "rides_driver_trips_status_check"
  CHECK ("status" IN ('declined', 'accepted', 'heading', 'started', 'completed', 'cancelled', 'unassigned'));
