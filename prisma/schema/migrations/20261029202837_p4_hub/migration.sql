-- Prisma's migration connection pins search_path to public; the exclusion constraint below
-- needs btree_gist, which lives in schema extensions (P1 decision).
SET search_path TO public, extensions;

-- True when every item is 1..max_len characters (NULL arrays and empty arrays pass).
CREATE FUNCTION hub_items_ok(items TEXT[], max_len INTEGER) RETURNS BOOLEAN
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT coalesce(bool_and(char_length(x) BETWEEN 1 AND max_len), true) FROM unnest(items) AS x $$;

-- CreateTable
CREATE TABLE "hub_profiles" (
    "user_id" UUID NOT NULL,
    "branch" TEXT,
    "year" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "target_role" TEXT,
    "target_companies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "placement_deadline" DATE,
    "is_peer_mentor" BOOLEAN NOT NULL DEFAULT false,
    "mentor_expertise" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mentor_department" TEXT,
    "mentor_capacity" SMALLINT NOT NULL DEFAULT 3,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hub_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "hub_topics" (
    "id" TEXT NOT NULL,
    "track" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "total_items" SMALLINT NOT NULL,
    "sort" SMALLINT NOT NULL,

    CONSTRAINT "hub_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hub_topic_progress" (
    "user_id" UUID NOT NULL,
    "topic_id" TEXT NOT NULL,
    "total_items" SMALLINT NOT NULL,
    "solved" SMALLINT NOT NULL DEFAULT 0,
    "tracked_since" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hub_topic_progress_pkey" PRIMARY KEY ("user_id","topic_id")
);

-- CreateTable
CREATE TABLE "hub_progress_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "topic_id" TEXT NOT NULL,
    "delta" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hub_progress_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hub_weekly_goals" (
    "user_id" UUID NOT NULL,
    "week_start" DATE NOT NULL,
    "target" SMALLINT NOT NULL DEFAULT 20,

    CONSTRAINT "hub_weekly_goals_pkey" PRIMARY KEY ("user_id","week_start")
);

-- CreateTable
CREATE TABLE "hub_mentor_slots" (
    "id" UUID NOT NULL,
    "mentor_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "location_label" TEXT,
    "location_stop_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hub_mentor_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hub_mentorship_requests" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "mentor_id" UUID NOT NULL,
    "slot_id" UUID,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hub_mentorship_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hub_subjects" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" SMALLINT NOT NULL,

    CONSTRAINT "hub_subjects_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "hub_resources" (
    "id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "subject" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "semester" SMALLINT,
    "exam_year" SMALLINT,
    "uploader_id" UUID NOT NULL,
    -- Generated: title and subject weigh more than the description. 'english' stems words
    -- (notes → note); subject codes use 'simple' so OS/CN are never treated as words.
    "search" tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('english', "title"), 'A') ||
      setweight(to_tsvector('simple', "subject"), 'A') ||
      setweight(to_tsvector('english', coalesce("description", '')), 'B')
    ) STORED,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "hub_resources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hub_profiles_is_peer_mentor_idx" ON "hub_profiles"("is_peer_mentor") WHERE (is_peer_mentor);

-- CreateIndex
CREATE UNIQUE INDEX "hub_topics_name_key" ON "hub_topics"("name");

-- CreateIndex
CREATE UNIQUE INDEX "hub_topics_tag_key" ON "hub_topics"("tag");

-- CreateIndex
CREATE INDEX "hub_topics_track_sort_idx" ON "hub_topics"("track", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "hub_topics_id_total_items_key" ON "hub_topics"("id", "total_items");

-- CreateIndex
CREATE INDEX "hub_topic_progress_topic_id_total_items_idx" ON "hub_topic_progress"("topic_id", "total_items");

-- CreateIndex
CREATE INDEX "hub_progress_events_user_id_created_at_idx" ON "hub_progress_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "hub_progress_events_topic_id_idx" ON "hub_progress_events"("topic_id");

-- CreateIndex
CREATE INDEX "hub_mentor_slots_mentor_id_status_starts_at_idx" ON "hub_mentor_slots"("mentor_id", "status", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "hub_mentor_slots_live_start_key" ON "hub_mentor_slots"("mentor_id", "starts_at") WHERE (status <> 'cancelled');

-- CreateIndex
CREATE INDEX "hub_mentorship_requests_mentor_id_status_created_at_id_idx" ON "hub_mentorship_requests"("mentor_id", "status", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "hub_mentorship_requests_student_id_created_at_id_idx" ON "hub_mentorship_requests"("student_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "hub_mentorship_requests_slot_id_idx" ON "hub_mentorship_requests"("slot_id");

-- CreateIndex
CREATE UNIQUE INDEX "hub_requests_one_live_key" ON "hub_mentorship_requests"("student_id", "mentor_id") WHERE (status IN ('pending', 'accepted'));

-- CreateIndex
CREATE UNIQUE INDEX "hub_resources_file_id_key" ON "hub_resources"("file_id");

-- CreateIndex
CREATE INDEX "hub_resources_search_idx" ON "hub_resources" USING GIN ("search");

-- CreateIndex
CREATE INDEX "hub_resources_live_idx" ON "hub_resources"("created_at" DESC, "id" DESC) WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "hub_resources_subject_created_at_id_idx" ON "hub_resources"("subject", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "hub_resources_type_idx" ON "hub_resources"("type");

-- CreateIndex
CREATE INDEX "hub_resources_semester_idx" ON "hub_resources"("semester");

-- CreateIndex
CREATE INDEX "hub_resources_uploader_id_idx" ON "hub_resources"("uploader_id");

-- AddForeignKey
ALTER TABLE "hub_profiles" ADD CONSTRAINT "hub_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_topic_progress" ADD CONSTRAINT "hub_topic_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "hub_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_topic_progress" ADD CONSTRAINT "hub_topic_progress_topic_id_total_items_fkey" FOREIGN KEY ("topic_id", "total_items") REFERENCES "hub_topics"("id", "total_items") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_progress_events" ADD CONSTRAINT "hub_progress_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "hub_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_progress_events" ADD CONSTRAINT "hub_progress_events_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "hub_topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_weekly_goals" ADD CONSTRAINT "hub_weekly_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "hub_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_mentor_slots" ADD CONSTRAINT "hub_mentor_slots_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "hub_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_mentorship_requests" ADD CONSTRAINT "hub_mentorship_requests_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "hub_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_mentorship_requests" ADD CONSTRAINT "hub_mentorship_requests_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "hub_profiles"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_mentorship_requests" ADD CONSTRAINT "hub_mentorship_requests_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "hub_mentor_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_resources" ADD CONSTRAINT "hub_resources_subject_fkey" FOREIGN KEY ("subject") REFERENCES "hub_subjects"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_resources" ADD CONSTRAINT "hub_resources_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "hub_profiles"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints (enum-like text, sizes and ranges).
ALTER TABLE "hub_profiles"
  ADD CONSTRAINT "hub_profiles_year_check" CHECK ("year" IN ('FE', 'SE', 'TE', 'BE')),
  ADD CONSTRAINT "hub_profiles_branch_check" CHECK (char_length("branch") BETWEEN 1 AND 80),
  ADD CONSTRAINT "hub_profiles_skills_check" CHECK (coalesce(cardinality("skills"), 0) <= 30 AND hub_items_ok("skills", 40)),
  ADD CONSTRAINT "hub_profiles_interests_check" CHECK (coalesce(cardinality("interests"), 0) <= 20 AND hub_items_ok("interests", 40)),
  ADD CONSTRAINT "hub_profiles_target_role_check" CHECK (char_length("target_role") BETWEEN 1 AND 80),
  ADD CONSTRAINT "hub_profiles_target_companies_check" CHECK (coalesce(cardinality("target_companies"), 0) <= 10 AND hub_items_ok("target_companies", 60)),
  ADD CONSTRAINT "hub_profiles_mentor_expertise_check" CHECK (coalesce(cardinality("mentor_expertise"), 0) <= 15 AND hub_items_ok("mentor_expertise", 40)),
  ADD CONSTRAINT "hub_profiles_mentor_department_check" CHECK (char_length("mentor_department") BETWEEN 1 AND 80),
  ADD CONSTRAINT "hub_profiles_mentor_capacity_check" CHECK ("mentor_capacity" BETWEEN 0 AND 20);

ALTER TABLE "hub_topics"
  ADD CONSTRAINT "hub_topics_track_check" CHECK ("track" IN ('dsa', 'aptitude', 'core', 'interview', 'resume')),
  ADD CONSTRAINT "hub_topics_total_items_check" CHECK ("total_items" BETWEEN 1 AND 1000);

ALTER TABLE "hub_topic_progress"
  ADD CONSTRAINT "hub_topic_progress_solved_check" CHECK ("solved" BETWEEN 0 AND "total_items");

ALTER TABLE "hub_progress_events"
  ADD CONSTRAINT "hub_progress_events_delta_check" CHECK ("delta" <> 0 AND "delta" BETWEEN -1000 AND 1000);

ALTER TABLE "hub_weekly_goals"
  ADD CONSTRAINT "hub_weekly_goals_target_check" CHECK ("target" BETWEEN 1 AND 200),
  ADD CONSTRAINT "hub_weekly_goals_sunday_check" CHECK (extract(isodow FROM "week_start") = 7);

ALTER TABLE "hub_mentor_slots"
  ADD CONSTRAINT "hub_mentor_slots_status_check" CHECK ("status" IN ('open', 'booked', 'cancelled')),
  ADD CONSTRAINT "hub_mentor_slots_length_check" CHECK ("ends_at" - "starts_at" BETWEEN interval '30 minutes' AND interval '180 minutes'),
  ADD CONSTRAINT "hub_mentor_slots_location_check" CHECK (char_length("location_label") BETWEEN 1 AND 120),
  -- Two live slots of one mentor never overlap; a cancelled slot frees its time.
  ADD CONSTRAINT "hub_mentor_slots_no_overlap" EXCLUDE USING gist (
    "mentor_id" WITH =,
    tstzrange("starts_at", "ends_at") WITH &&
  ) WHERE ("status" <> 'cancelled');

ALTER TABLE "hub_mentorship_requests"
  ADD CONSTRAINT "hub_mentorship_requests_status_check" CHECK ("status" IN ('pending', 'accepted', 'declined', 'cancelled', 'completed')),
  ADD CONSTRAINT "hub_mentorship_requests_note_check" CHECK (char_length("note") BETWEEN 1 AND 500),
  ADD CONSTRAINT "hub_mentorship_requests_not_self_check" CHECK ("student_id" <> "mentor_id"),
  ADD CONSTRAINT "hub_mentorship_requests_accepted_slot_check" CHECK ("status" NOT IN ('accepted', 'completed') OR "slot_id" IS NOT NULL);

ALTER TABLE "hub_resources"
  ADD CONSTRAINT "hub_resources_title_check" CHECK (char_length("title") BETWEEN 3 AND 160),
  ADD CONSTRAINT "hub_resources_description_check" CHECK (char_length("description") <= 1000),
  ADD CONSTRAINT "hub_resources_type_check" CHECK ("type" IN ('notes', 'question_paper', 'study_material', 'cheat_sheet')),
  ADD CONSTRAINT "hub_resources_semester_check" CHECK ("semester" BETWEEN 1 AND 8),
  ADD CONSTRAINT "hub_resources_exam_year_check" CHECK ("exam_year" BETWEEN 1990 AND 2100);
