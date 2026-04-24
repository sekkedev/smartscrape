export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
};

export type ApiResponse<T> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: ApiError };

export function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

export function fail(code: string, message: string, details?: unknown): ApiResponse<never> {
  return { success: false, data: null, error: { code, message, details } };
}
