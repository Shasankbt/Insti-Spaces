import type { Role } from './types';

export const roleRank: Record<Role, number> = {
  viewer: 1,
  contributor: 2,
  moderator: 3,
  admin: 4,
};

interface RolePermissions {
  canInviteRoles: Role[];
  canChangeRoles: Role[];
  canAssignRoles: Role[];
  canRemoveRoles: Role[];
  canApproveRequests: boolean;
}

// Defines what each role is permitted to do in a space.
const ROLE_PERMISSIONS: Record<Role, RolePermissions> = {
  admin: {
    canInviteRoles:     ['viewer', 'contributor', 'moderator'],
    canChangeRoles:     ['viewer', 'contributor', 'moderator'],
    canAssignRoles:     ['viewer', 'contributor', 'moderator'],
    canRemoveRoles:     ['viewer', 'contributor', 'moderator'],
    canApproveRequests: true,
  },
  moderator: {
    canInviteRoles:     ['viewer', 'contributor', 'moderator'],
    canChangeRoles:     ['viewer', 'contributor', 'moderator'],
    canAssignRoles:     ['viewer', 'contributor', 'moderator'],
    canRemoveRoles:     ['viewer', 'contributor', 'moderator'],
    canApproveRequests: true,
  },
  contributor: {
    canInviteRoles:     [],
    canChangeRoles:     [],
    canAssignRoles:     [],
    canRemoveRoles:     [],
    canApproveRequests: false,
  },
  viewer: {
    canInviteRoles:     [],
    canChangeRoles:     [],
    canAssignRoles:     [],
    canRemoveRoles:     [],
    canApproveRequests: false,
  },
};

export function canInviteAs(myRole: Role, inviteRole: Role): boolean {
  return ROLE_PERMISSIONS[myRole].canInviteRoles.includes(inviteRole);
}

export function canChangeRole(myRole: Role, targetCurrentRole: Role, newRole: Role): boolean {
  const perms = ROLE_PERMISSIONS[myRole];
  return perms.canChangeRoles.includes(targetCurrentRole) && perms.canAssignRoles.includes(newRole);
}

export function canRemoveRole(myRole: Role, targetRole: Role): boolean {
  return ROLE_PERMISSIONS[myRole].canRemoveRoles.includes(targetRole);
}

export function canApproveRoleRequest(myRole: Role): boolean {
  return ROLE_PERMISSIONS[myRole].canApproveRequests;
}

export { ROLE_PERMISSIONS };
