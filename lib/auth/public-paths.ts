const exactPublicPagePaths = new Set(["/api-docs"]);

/** Pages that must remain reachable before a user has authenticated. */
export function isPublicPagePath(pathname: string): boolean {
  return (
    exactPublicPagePaths.has(pathname) ||
    pathname === "/join" ||
    pathname.startsWith("/join/")
  );
}
