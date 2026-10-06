/** IAM API types + query keys shared by the settings pages. */

export interface RoleRef {
  id: string;
  name: string;
}

export interface Member {
  membershipId: string;
  userId: string;
  email: string;
  fullName: string;
  mobile: string | null;
  status: "invited" | "active" | "disabled";
  isOwner: boolean;
  joinedAt: string;
  lastLoginAt: string | null;
  mfaEnabled: boolean;
  roles: RoleRef[];
}

export interface Invitation {
  id: string;
  email: string;
  fullName: string | null;
  roles: RoleRef[];
  expiresAt: string;
  createdAt: string;
  invitedBy: string | null;
  expired: boolean;
}

export interface InvitationLink {
  id: string;
  email: string;
  inviteUrl: string;
  expiresAt: string;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  memberCount: number;
}

export interface PermissionGroup {
  module: string;
  label: string;
  permissions: { code: string; resource: string; action: string; description: string }[];
}

export const iamKeys = {
  users: ["iam", "users"] as const,
  invitations: ["iam", "invitations"] as const,
  roles: ["iam", "roles"] as const,
  permissions: ["iam", "permissions"] as const,
};
