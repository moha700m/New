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

export function isOwnerAccount(u: { role: string; email: string }) {
  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  return u.role === "OWNER" || Boolean(owner && owner === u.email.toLowerCase());
}
