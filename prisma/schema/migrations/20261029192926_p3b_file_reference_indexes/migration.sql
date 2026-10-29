-- CreateIndex
CREATE INDEX "rides_driver_documents_file_id_idx" ON "rides_driver_documents"("file_id");

-- CreateIndex
CREATE INDEX "rides_vehicle_inspections_tyres_file_id_idx" ON "rides_vehicle_inspections"("tyres_file_id");

-- CreateIndex
CREATE INDEX "rides_vehicle_inspections_lights_file_id_idx" ON "rides_vehicle_inspections"("lights_file_id");

-- CreateIndex
CREATE INDEX "rides_vehicle_inspections_seats_file_id_idx" ON "rides_vehicle_inspections"("seats_file_id");

-- CreateIndex
CREATE INDEX "rides_vehicle_inspections_meter_file_id_idx" ON "rides_vehicle_inspections"("meter_file_id");
