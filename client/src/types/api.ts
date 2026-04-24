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

export type HealthStatus = {
  status: 'healthy' | 'degraded';
  checks: {
    database: { ok: boolean; error?: string };
    redis: { ok: boolean; error?: string };
  };
  uptime: number;
  timestamp: string;
};
