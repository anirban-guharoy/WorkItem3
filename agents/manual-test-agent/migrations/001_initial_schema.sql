-- Generation jobs: one row per requested generation; `version` is the optimistic-concurrency token.
CREATE TABLE generation_jobs (
  id                      uuid PRIMARY KEY,
  issue_key               text        NOT NULL,
  project_key             text        NOT NULL,
  status                  text        NOT NULL CHECK (status IN (
                            'queued','running','draft_ready','awaiting_review','needs_clarification',
                            'approved','rejected','publishing','published','failed','cancelled')),
  attempt                 integer     NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  version                 integer     NOT NULL DEFAULT 1,
  draft_version           integer     NOT NULL DEFAULT 0,
  requested_by            text        NOT NULL,
  requester_entitlements  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key         text,
  correlation_id          text        NOT NULL,
  notes                   text,
  story_hash              text,
  failure_category        text,
  failure_message         text,
  clarification_questions jsonb       NOT NULL DEFAULT '[]'::jsonb,
  locked_by               text,
  lease_expires_at        timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX generation_jobs_idempotency_uq
  ON generation_jobs (requested_by, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX generation_jobs_project_created_idx ON generation_jobs (project_key, created_at DESC);
CREATE INDEX generation_jobs_issue_idx ON generation_jobs (issue_key);
CREATE INDEX generation_jobs_recovery_idx ON generation_jobs (status, lease_expires_at)
  WHERE status IN ('queued','running','publishing');

-- Defence in depth: the database independently enforces the legal state machine.
CREATE FUNCTION enforce_job_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD.status = 'queued'              AND NEW.status IN ('running','cancelled','failed')) OR
    (OLD.status = 'running'             AND NEW.status IN ('queued','draft_ready','awaiting_review','needs_clarification','failed','cancelled')) OR
    (OLD.status = 'draft_ready'         AND NEW.status IN ('awaiting_review','failed','cancelled')) OR
    (OLD.status = 'awaiting_review'     AND NEW.status IN ('approved','rejected','queued','cancelled','failed')) OR
    (OLD.status = 'needs_clarification' AND NEW.status IN ('queued','cancelled')) OR
    (OLD.status = 'approved'            AND NEW.status IN ('publishing','awaiting_review','cancelled')) OR
    (OLD.status = 'publishing'          AND NEW.status IN ('published','failed','approved')) OR
    (OLD.status = 'failed'              AND NEW.status IN ('queued','publishing'))
  ) THEN
    RAISE EXCEPTION 'invalid job state transition % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER generation_jobs_transition BEFORE UPDATE OF status ON generation_jobs
  FOR EACH ROW EXECUTE FUNCTION enforce_job_transition();

CREATE TABLE generation_results (
  id                uuid PRIMARY KEY,
  job_id            uuid        NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  attempt           integer     NOT NULL,
  story_hash        text        NOT NULL,
  story_summary     text        NOT NULL,
  criteria          jsonb       NOT NULL,
  context_refs      jsonb       NOT NULL,
  analysis          jsonb,
  ambiguities       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  validation        jsonb       NOT NULL,
  duplicates        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  model_info        jsonb       NOT NULL,
  quality_metrics   jsonb       NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, attempt)
);

CREATE TABLE test_case_drafts (
  id            uuid PRIMARY KEY,
  job_id        uuid        NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  draft_version integer     NOT NULL CHECK (draft_version >= 1),
  test_cases    jsonb       NOT NULL,
  content_hash  text        NOT NULL,
  origin        text        NOT NULL CHECK (origin IN ('model','reviewer_edit')),
  created_by    text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, draft_version)
);

CREATE TABLE coverage_results (
  id            uuid PRIMARY KEY,
  job_id        uuid        NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  draft_version integer     NOT NULL,
  records       jsonb       NOT NULL,
  summary       jsonb       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, draft_version)
);

CREATE TABLE review_decisions (
  id            uuid PRIMARY KEY,
  job_id        uuid        NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  draft_version integer     NOT NULL,
  action        text        NOT NULL CHECK (action IN ('approve','reject','edit','request_regeneration')),
  reviewer      text        NOT NULL,
  comment       text,
  content_hash  text        NOT NULL,
  revoked_at    timestamptz,
  revoked_reason text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_decisions_job_idx ON review_decisions (job_id, created_at);
CREATE UNIQUE INDEX review_decisions_one_active_approval_uq
  ON review_decisions (job_id, draft_version) WHERE action = 'approve' AND revoked_at IS NULL;

CREATE TABLE publication_records (
  id                   uuid PRIMARY KEY,
  job_id               uuid        NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
  issue_key            text        NOT NULL,
  draft_version        integer     NOT NULL,
  approval_decision_id uuid        NOT NULL REFERENCES review_decisions(id),
  destination          text        NOT NULL,
  content_hash         text        NOT NULL,
  status               text        NOT NULL CHECK (status IN ('pending','in_progress','published','failed')),
  requested_by         text        NOT NULL,
  results              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  error_category       text,
  error_message        text,
  version              integer     NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz,
  UNIQUE (job_id, draft_version)
);
-- At most one successful publication of the same content to the same destination.
CREATE UNIQUE INDEX publication_records_published_uq
  ON publication_records (issue_key, destination, content_hash) WHERE status = 'published';

CREATE TABLE audit_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id         uuid,
  event_type     text        NOT NULL,
  actor          text        NOT NULL,
  correlation_id text,
  details        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_job_idx ON audit_events (job_id, id);
CREATE INDEX audit_events_type_idx ON audit_events (event_type, created_at);

CREATE FUNCTION audit_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();
