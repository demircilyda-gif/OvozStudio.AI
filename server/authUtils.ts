// -------------------------------------------------------------
// Admin & Authorization Utilities
// -------------------------------------------------------------

export const getAdminEmails = (): string[] => {
  const envEmails = process.env.ADMIN_EMAILS || "";
  const emails = envEmails
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  // If no ADMIN_EMAILS environment variable is provided, allow the default owner email
  if (emails.length === 0) {
    emails.push("demircilyda@gmail.com");
  }
  return emails;
};

export const isEmailAdmin = (email?: string | null): boolean => {
  if (!email) return false;
  return getAdminEmails().includes(email.trim().toLowerCase());
};
