export type PublicUser = {
  id: string;
  email: string;
  name: string | null;
  email_verified: boolean;
  telegram_chat_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Session = {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
};

export type LoginResponse = Session & { user: PublicUser };
export type RegisterResponse = { user: PublicUser; devToken?: string };
export type RefreshResponse = Session;

export type ApiError = {
  code: string;
  message: string;
  details?: { path: string; message: string }[];
};

export type ApiResponse<T> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: ApiError };

export type Provider = 'openai' | 'anthropic' | 'openrouter';

export type ProviderSummary = {
  provider: Provider;
  connected: boolean;
  created_at: string;
};

export type ProviderTestResult = {
  ok: boolean;
  latencyMs: number;
  error?: string;
};

export type ScrapeMethod = 'auto' | 'cheerio' | 'playwright';
export type SetupMethod = 'ai' | 'manual';
export type NotifyChannel = 'email' | 'telegram';
export type RunStatus = 'pending' | 'scraping' | 'extracting' | 'exporting' | 'completed' | 'failed';

export type FieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';
export type ExtractionSchema = Record<string, FieldType>;

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

export type Job = {
  id: string;
  user_id: string;
  name: string;
  urls: string[];
  extraction_prompt: string;
  extraction_schema: ExtractionSchema | null;
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
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
};

export type JobListItem = Job & {
  last_run_status: RunStatus | null;
  last_run_items: number | null;
};

export type Run = {
  id: string;
  job_id: string;
  status: RunStatus;
  urls_scraped: number;
  items_extracted: number;
  tokens_used: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
};

export type ExtractedData = {
  id: string;
  run_id: string;
  job_id: string;
  source_url: string;
  data: Record<string, unknown>;
  data_hash: string;
  created_at: string;
};

export type HealthStatus = {
  status: 'healthy' | 'degraded';
  checks: {
    database: { ok: boolean; error?: string };
    redis: { ok: boolean; error?: string };
  };
  uptime: number;
  timestamp: string;
};
