-- CreateTable
CREATE TABLE "wb_settings" (
    "user_id" UUID NOT NULL,
    "tracking" TEXT NOT NULL DEFAULT 'off',
    "paused_since" TIMESTAMPTZ(3),
    "categories" TEXT[] DEFAULT ARRAY['study', 'communication', 'social', 'entertainment']::TEXT[],
    "retention_days" SMALLINT NOT NULL DEFAULT 90,
    "share_study_with_hub" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wb_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "wb_daily_totals" (
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "minutes" SMALLINT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wb_daily_totals_pkey" PRIMARY KEY ("user_id","date","category")
);

-- CreateTable
CREATE TABLE "wb_weekly_summaries" (
    "user_id" UUID NOT NULL,
    "week_start" DATE NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wb_weekly_summaries_pkey" PRIMARY KEY ("user_id","week_start")
);

-- CreateIndex
CREATE INDEX "wb_settings_tracking_idx" ON "wb_settings"("tracking");

-- CreateIndex
CREATE INDEX "wb_daily_totals_date_idx" ON "wb_daily_totals"("date");

-- AddForeignKey
ALTER TABLE "wb_settings" ADD CONSTRAINT "wb_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wb_daily_totals" ADD CONSTRAINT "wb_daily_totals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "wb_settings"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wb_weekly_summaries" ADD CONSTRAINT "wb_weekly_summaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "wb_settings"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CHECK constraints (enum-like text and ranges; Prisma does not model them, so no drift).
ALTER TABLE "wb_settings"
  ADD CONSTRAINT "wb_settings_tracking_check" CHECK ("tracking" IN ('on', 'paused', 'off')),
  ADD CONSTRAINT "wb_settings_paused_since_check" CHECK (("tracking" = 'paused') = ("paused_since" IS NOT NULL)),
  ADD CONSTRAINT "wb_settings_categories_check" CHECK ("categories" IS NOT NULL AND cardinality("categories") <= 5
    AND "categories" <@ ARRAY['study', 'communication', 'social', 'entertainment', 'other']::TEXT[]),
  ADD CONSTRAINT "wb_settings_retention_check" CHECK ("retention_days" BETWEEN 7 AND 365);

ALTER TABLE "wb_daily_totals"
  ADD CONSTRAINT "wb_daily_totals_category_check" CHECK ("category" IN ('study', 'communication', 'social', 'entertainment', 'other')),
  ADD CONSTRAINT "wb_daily_totals_minutes_check" CHECK ("minutes" BETWEEN 0 AND 1440);
