// Mirrors of the server DTOs the CLI consumes. Kept narrow on purpose — the
// CLI only renders/forwards a subset, so we don't pull the full server type.

export type ApiError = { code: string; message: string; details?: unknown };

export type ApiResponse<T> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: ApiError };

export type Provider = 'openai' | 'anthropic' | 'openrouter';
export type ScrapeMethod = 'auto' | 'playwright' | 'cheerio';
export type SetupMethod = 'ai' | 'manual';
export type NotifyChannel = 'email' | 'telegram';
export type RunStatus =
  | 'pending'
  | 'scraping'
  | 'extracting'
  | 'exporting'
  | 'completed'
  | 'failed';

export type ErrorType =
  | 'timeout'
  | 'blocked'
  | 'parse_error'
  | 'ai_error'
  | 'network_error'
  | 'quota_error'
  | 'unknown';

export type NotificationRule =
  | { type: 'any_change'; message?: string }
  | { type: 'new_items'; message?: string }
  | { type: 'removed_items'; message?: string }
  | {
      type: 'field_threshold';
      field: string;
      operator:
        | 'less_than'
        | 'greater_than'
        | 'equals'
        | 'not_equals'
        | 'less_than_or_equal'
        | 'greater_than_or_equal';
      value: number | string;
      message?: string;
    }
  | { type: 'field_change'; field: string; message?: string };

export type JobDTO = {
  id: string;
  user_id: string;
  name: string;
  urls: string[];
  extraction_prompt: string;
  extraction_schema: Record<string, 'string' | 'number' | 'boolean' | 'array' | 'object'> | null;
  scrape_method: ScrapeMethod;
  schedule: string | null;
  enabled: boolean;
  notification_rules: NotificationRule[];
  notify_channels: NotifyChannel[];
  comparison_key: string | null;
  ai_provider: Provider;
  ai_model: string;
  google_sheet_id: string | null;
  sheet_tab_name: string | null;
  setup_method: SetupMethod;
  respect_robots_txt: boolean;
  stealth_mode: boolean;
  proxy_url: string | null;
  pacing_min_ms: number | null;
  pacing_max_ms: number | null;
  webhook_url: string | null;
  webhook_secret_configured: boolean;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
};

export type JobListItem = JobDTO & {
  last_run_status: string | null;
  last_run_items: number | null;
  last_run_error_type: ErrorType | null;
};

export type RunDTO = {
  id: string;
  job_id: string;
  status: RunStatus;
  urls_scraped: number;
  items_extracted: number;
  tokens_used: number;
  error_message: string | null;
  error_type: ErrorType | null;
  export_error: string | null;
  started_at: string;
  completed_at: string | null;
  webhook_status: 'success' | 'failed' | null;
  webhook_attempts: number;
  webhook_last_error: string | null;
  webhook_delivered_at: string | null;
};

export type ExtractedDataDTO = {
  id: string;
  run_id: string;
  job_id: string;
  source_url: string;
  data: Record<string, unknown>;
  data_hash: string;
  created_at: string;
};

export type DiffResult = {
  current_run: { id: string; started_at: string };
  previous_run: { id: string; started_at: string } | null;
  added: Record<string, unknown>[];
  removed: Record<string, unknown>[];
  changed: {
    key: string | null;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    field_diffs: { field: string; old: unknown; new: unknown }[];
  }[];
  comparison_key: string | null;
};

export type ProviderRow = {
  provider: Provider;
  created_at: string;
  updated_at: string;
};

export type DashboardStats = {
  active_jobs: number;
  runs_today: number;
  items_tracked: number;
  changes_this_week: number;
};

export type UserPublic = {
  id: string;
  email: string;
  name: string | null;
  email_verified: boolean;
  telegram_chat_id: string | null;
};

export type AccessToken = {
  id: string;
  name: string;
  prefix: string;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
};
