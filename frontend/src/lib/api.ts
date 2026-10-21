// Minimal API client. A typed client generated from /openapi.json can replace it once there are more endpoints.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}, accessToken?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const response = await fetch(`/api/v1${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = typeof body.detail === "string" ? body.detail : "Something went wrong. Please try again.";
    throw new ApiError(response.status, detail, body.code);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}
