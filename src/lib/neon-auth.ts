// Legacy Neon auth shim. The project now uses Lovable Cloud (Supabase) auth.
// These stubs keep the compiled server function surface intact; the real
// sign-in / sign-up flows live in src/lib/auth-context.tsx via the Supabase
// client. The server function in src/lib/auth.server.functions.ts is no
// longer wired up to any UI.

export interface NeonUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NeonSession {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

export async function authenticateUser(
  _username: string,
  _password: string,
): Promise<{ user: NeonUser; session: NeonSession } | { error: string }> {
  return { error: "Legacy auth disabled; use Lovable Cloud sign-in." };
}

export async function createUser(
  _email: string,
  _password: string,
  _name: string,
): Promise<{ user: NeonUser } | { error: string }> {
  return { error: "Legacy auth disabled; use Lovable Cloud sign-up." };
}
