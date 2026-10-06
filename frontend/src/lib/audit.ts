/** Human-readable labels for audit actions. Unknown actions fall back to the raw code. */
const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Signed in",
  "tenant.provisioned": "Created the workspace",
  "org.company.created": "Created a company",
  "iam.member.updated": "Changed a user's access",
  "iam.invitation.created": "Invited a user",
  "iam.invitation.resent": "Re-issued an invitation link",
  "iam.invitation.revoked": "Withdrew an invitation",
  "iam.invitation.accepted": "Joined the workspace",
  "iam.role.created": "Created a role",
  "iam.role.updated": "Changed a role",
  "iam.role.deleted": "Deleted a role",
  "account.profile.updated": "Updated their profile",
  "account.password.changed": "Changed their password",
  "account.session.revoked": "Signed out a device",
  "account.sessions.revoked_others": "Signed out all other devices",
};

export function auditActionLabel(action: string) {
  return ACTION_LABELS[action] ?? action;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
  actor: { id: string | null; fullName: string | null; email: string | null };
}

export interface AuditPage {
  items: AuditEntry[];
  nextCursor: string | null;
}

/** "Chrome on Windows" style summary of a user-agent string. */
export function describeDevice(ua: string | null | undefined) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : /node|undici|curl/i.test(ua)
              ? "API client"
              : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}
