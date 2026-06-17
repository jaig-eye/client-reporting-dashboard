-- Personal access tokens for Claude Code dashboard MCP integration.
-- Each admin user generates their own token; stored as SHA-256 hash, never plaintext.

CREATE TABLE IF NOT EXISTS public.mcp_tokens (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash    TEXT        NOT NULL UNIQUE,
  token_prefix  TEXT        NOT NULL,
  label         TEXT        NOT NULL DEFAULT 'My Token',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX idx_mcp_tokens_user_id ON public.mcp_tokens(user_id);
CREATE INDEX idx_mcp_tokens_hash    ON public.mcp_tokens(token_hash);

ALTER TABLE public.mcp_tokens ENABLE ROW LEVEL SECURITY;
