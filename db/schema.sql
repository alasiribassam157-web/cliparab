-- ClipArab PostgreSQL schema (production target; the MVP API ships with SQLite, see apps/api/app/db.py).
-- Requires PostgreSQL 14+. Row-Level Security isolates tenants by team_id via the session setting app.team_id:
--     SET LOCAL app.team_id = '<uuid>';   -- done by the API at the start of every request
-- Roles: the application must connect as a NON-superuser role without BYPASSRLS.

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

CREATE TYPE plan_tier       AS ENUM ('free', 'pro', 'team');
CREATE TYPE project_status  AS ENUM ('empty', 'ready', 'processing', 'done', 'error');
CREATE TYPE job_kind        AS ENUM ('analyze', 'export', 'purge');
CREATE TYPE job_status      AS ENUM ('queued', 'running', 'done', 'error', 'canceled');
CREATE TYPE member_role     AS ENUM ('owner', 'editor', 'reviewer');
CREATE TYPE export_status   AS ENUM ('queued', 'running', 'done', 'error', 'expired');

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE CHECK (email = lower(email)),
  name          text NOT NULL DEFAULT '',
  pw_hash       text,
  locale        text NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar', 'en')),
  allow_training boolean NOT NULL DEFAULT false,         -- explicit opt-in only
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teams (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  plan       plan_tier NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    member_role NOT NULL DEFAULT 'editor',
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE projects (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id        uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_by     uuid NOT NULL REFERENCES users(id),
  name           text NOT NULL,
  language       text NOT NULL DEFAULT 'ar',
  status         project_status NOT NULL DEFAULT 'empty',
  retention_days integer NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 365),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_team ON projects (team_id, created_at DESC);

CREATE TABLE source_videos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  filename    text NOT NULL,
  storage_key text NOT NULL,                                 -- S3/R2 object key
  size_bytes  bigint NOT NULL,
  duration_s  double precision NOT NULL,
  width       integer, height integer, fps real,
  origin      text NOT NULL DEFAULT 'upload' CHECK (origin IN ('upload', 'official_api')),  -- no scraping, ever
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE video_assets (                                  -- proxy, audio, thumbnails, sprites
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  source_id  uuid NOT NULL REFERENCES source_videos(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('proxy_360p', 'audio_16k', 'thumbnail', 'sprite')),
  storage_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, kind)
);

CREATE TABLE transcripts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  project_id uuid NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  language   text NOT NULL,
  dialect    text,
  engine     text NOT NULL,
  avg_confidence real,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE speakers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  transcript_id uuid NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  label         text NOT NULL,                               -- "SPEAKER_00"
  display_name  text
);

CREATE TABLE transcript_segments (
  id            bigserial PRIMARY KEY,
  team_id       uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  transcript_id uuid NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  idx           integer NOT NULL,
  start_s       double precision NOT NULL,
  end_s         double precision NOT NULL CHECK (end_s >= start_s),
  speaker_id    uuid REFERENCES speakers(id) ON DELETE SET NULL,
  text          text NOT NULL,
  words         jsonb NOT NULL DEFAULT '[]',                 -- [{text,start,end,conf,approx}]
  confidence    real,
  UNIQUE (transcript_id, idx)
);
CREATE INDEX transcript_segments_time ON transcript_segments (transcript_id, start_s);

CREATE TABLE clip_suggestions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rank            integer NOT NULL,
  start_s         double precision NOT NULL,
  end_s           double precision NOT NULL CHECK (end_s > start_s),
  clip_type       text NOT NULL,
  total           real NOT NULL CHECK (total BETWEEN 0 AND 100),
  score_breakdown jsonb NOT NULL,                            -- {hook,complete,value,audio,visual,engage,penalties}
  reason_ar       text NOT NULL DEFAULT '',
  title           text NOT NULL DEFAULT '',
  hooks           jsonb NOT NULL DEFAULT '[]',
  engine          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, rank)
);

CREATE TABLE clips (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  suggestion_id uuid REFERENCES clip_suggestions(id) ON DELETE SET NULL,
  created_by    uuid NOT NULL REFERENCES users(id),
  title         text NOT NULL DEFAULT '',
  edit_state    jsonb NOT NULL,
  version       integer NOT NULL DEFAULT 1,                  -- optimistic concurrency (If-Match)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE captions (                                      -- user-edited caption tracks per clip
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id  uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  clip_id  uuid NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  words    jsonb NOT NULL,
  style    jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE templates (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid REFERENCES teams(id) ON DELETE CASCADE,       -- NULL = built-in
  name    text NOT NULL,
  style   jsonb NOT NULL
);

CREATE TABLE brand_kits (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name    text NOT NULL,
  colors  jsonb NOT NULL DEFAULT '{}',
  font    text,
  logo_key text
);

CREATE TABLE jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  project_id  uuid REFERENCES projects(id) ON DELETE CASCADE,
  kind        job_kind NOT NULL,
  status      job_status NOT NULL DEFAULT 'queued',
  progress    real NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 1),
  stage       text NOT NULL DEFAULT '',
  payload     jsonb NOT NULL DEFAULT '{}',
  result      jsonb,
  error_code  text, error_message_ar text, error_message_en text,
  attempts    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  started_at  timestamptz, finished_at timestamptz
);
-- Workers claim with:  SELECT id FROM jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
CREATE INDEX jobs_queue ON jobs (created_at) WHERE status = 'queued';

CREATE TABLE exports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  clip_id      uuid NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  job_id       uuid REFERENCES jobs(id) ON DELETE SET NULL,
  status       export_status NOT NULL DEFAULT 'queued',
  storage_key  text, size_bytes bigint, duration_s double precision,
  resolution   text NOT NULL CHECK (resolution IN ('720p', '1080p')),
  edit_version integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz
);

CREATE TABLE review_links (
  token          text PRIMARY KEY,
  team_id        uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  clip_id        uuid NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  allow_comments boolean NOT NULL DEFAULT true,
  expires_at     timestamptz NOT NULL
);

CREATE TABLE comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  clip_id    uuid NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  author     text NOT NULL,
  body       text NOT NULL CHECK (length(body) <= 2000),
  at_seconds real,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  team_id    uuid PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  plan       plan_tier NOT NULL,
  provider   text, provider_ref text,
  renews_at  timestamptz
);

CREATE TABLE usage_credits (                                 -- append-only ledger; balance = grant + SUM(delta_minutes)
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  delta_minutes double precision NOT NULL,
  reason        text NOT NULL,                               -- grant | analyze | refund
  ref           text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_credits_team ON usage_credits (team_id, created_at);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL, body jsonb NOT NULL DEFAULT '{}', read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid, user_id uuid, action text NOT NULL, meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------ Row-Level Security
-- Every tenant table is readable/writable only when team_id matches the session's app.team_id.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects','source_videos','video_assets','transcripts','speakers','transcript_segments',
                           'clip_suggestions','clips','captions','brand_kits','jobs','exports','review_links','comments',
                           'usage_credits','notifications']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
                      USING (team_id = nullif(current_setting('app.team_id', true), '')::uuid)
                      WITH CHECK (team_id = nullif(current_setting('app.team_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
-- templates: built-ins (team_id IS NULL) are visible to everyone, team templates only to the team.
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY templates_read  ON templates FOR SELECT
  USING (team_id IS NULL OR team_id = nullif(current_setting('app.team_id', true), '')::uuid);
CREATE POLICY templates_write ON templates FOR ALL
  USING (team_id = nullif(current_setting('app.team_id', true), '')::uuid)
  WITH CHECK (team_id = nullif(current_setting('app.team_id', true), '')::uuid);
