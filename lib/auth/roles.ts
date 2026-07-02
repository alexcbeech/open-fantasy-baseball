type AuthRoleInput = {
  role?: string | string[] | null;
  roles?: string[] | null;
};

export function normalizeAuthRoles(authUser: AuthRoleInput) {
  return [...new Set([authUser.role, ...(authUser.roles ?? [])].flat().filter((role): role is string => Boolean(role)))];
}

export function hasAdminRole(roles: readonly string[]) {
  return roles.some((role) => role.toLowerCase() === "admin");
}
