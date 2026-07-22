CREATE TABLE email_campaigns (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID          NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title            TEXT          NOT NULL,
  subject_line     TEXT,
  goal             TEXT,
  -- Primary content: image upload stored in Supabase storage (emails are image-based)
  preview_image_url TEXT,
  -- Fallback: raw HTML or external preview link
  html_content     TEXT,
  preview_url      TEXT,
  sent_at          DATE,
  utm_campaign     TEXT,
  -- Performance stats (entered manually after send)
  open_rate        DECIMAL(5,2),
  click_rate       DECIMAL(5,2),
  conversions      INT,
  revenue          DECIMAL(12,2),
  -- Review workflow
  status           TEXT          NOT NULL DEFAULT 'pending_review'
                   CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected')),
  reviewer_notes   TEXT,
  reviewed_by      UUID          REFERENCES users(id),
  reviewed_at      TIMESTAMPTZ,
  submitted_by     UUID          REFERENCES users(id),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE email_schedules (
  id                   UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID    NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  is_active            BOOLEAN NOT NULL DEFAULT true,
  emails_per_week      INT     NOT NULL DEFAULT 1,
  assigned_user_id     UUID    REFERENCES users(id),
  reminder_days_before INT     NOT NULL DEFAULT 2,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON email_campaigns(client_id, created_at DESC);
CREATE INDEX ON email_campaigns(status);
