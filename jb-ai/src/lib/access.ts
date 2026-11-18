/**
 * Private mode (default ON): the site is for the owner only.
 * - Registration is closed, visitors without a session only see the login page, and every other account is blocked.
 * - The owner (OWNER role or OWNER_EMAIL) gets an unlimited version of the top plan.
 * Reopen the site later by setting the Vercel env var PRIVATE_MODE=off and redeploying
 * (registration then follows Admin → System → "التسجيل مفتوح").
 */
export function isPrivateMode() {
  return (process.env.PRIVATE_MODE ?? "on").trim().toLowerCase() !== "off";
}

/** OWNER_EMAIL may hold one address or several separated by commas. */
export function ownerEmails(): string[] {
  return (process.env.OWNER_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isOwnerAccount(u: { role: string; email: string }) {
  return u.role === "OWNER" || ownerEmails().includes(u.email.toLowerCase());
}

/**
 * While private, sign-up is open only to create the OWNER_EMAIL account(s) that don't exist yet.
 * Once every owner email has an account, sign-up is closed for everyone again.
 */
export async function ownerSignupOpen(countUsersWithEmails: (emails: string[]) => Promise<number>) {
  const owners = ownerEmails();
  if (!owners.length) return false;
  return (await countUsersWithEmails(owners)) < owners.length;
}
