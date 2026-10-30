-- CreateTable
CREATE TABLE "platform_service_events" (
    "module" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_service_events_pkey" PRIMARY KEY ("module","idempotency_key")
);

-- CreateIndex
CREATE INDEX "platform_service_events_created_at_idx" ON "platform_service_events"("created_at");
