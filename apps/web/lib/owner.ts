// The owner cookie: a random id that stands in for "this browser" (FR-2). No account, no
// personal data. It's what makes reactions one per post per person (FR-8), and later what
// owns personas. Unsigned on purpose for now: forging one only gets you a fresh identity,
// which clearing cookies does anyway. Ownership of personas (Phase 3) will need it signed.
import { cookies } from "next/headers";

export const OWNER_COOKIE = "hb_owner";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function validOwnerId(value: string | undefined): string | undefined {
  return value && UUID.test(value) ? value : undefined;
}

/** The viewer's owner id on a server-rendered page, if they have one. */
export async function viewerId(): Promise<string | undefined> {
  return validOwnerId((await cookies()).get(OWNER_COOKIE)?.value);
}

export const ownerCookieOptions = (secure: boolean) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure,
  path: "/",
  maxAge: 60 * 60 * 24 * 400, // the longest browsers keep a cookie
});
