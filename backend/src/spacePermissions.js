const roleRank = { viewer: 1, contributor: 2, moderator: 3, admin: 4 };

// Defines what each role is permitted to do in a space.
const ROLE_PERMISSIONS = {
  admin: {
    canInviteRoles:     ['viewer', 'contributor', 'moderator'],
    canChangeRoles:     ['viewer', 'contributor', 'moderator'], // target's current roles that can be changed
    canAssignRoles:     ['viewer', 'contributor', 'moderator'], // new roles that can be assigned
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

function canInviteAs(myRole, inviteRole) {
  return (ROLE_PERMISSIONS[myRole]?.canInviteRoles ?? []).includes(inviteRole);
}

function canChangeRole(myRole, targetCurrentRole, newRole) {
  const perms = ROLE_PERMISSIONS[myRole];
  if (!perms) return false;
  return perms.canChangeRoles.includes(targetCurrentRole) && perms.canAssignRoles.includes(newRole);
}

function canRemoveRole(myRole, targetRole) {
  return (ROLE_PERMISSIONS[myRole]?.canRemoveRoles ?? []).includes(targetRole);
}

function canApproveRoleRequest(myRole) {
  return ROLE_PERMISSIONS[myRole]?.canApproveRequests === true;
}

module.exports = { roleRank, ROLE_PERMISSIONS, canInviteAs, canChangeRole, canRemoveRole, canApproveRoleRequest };
