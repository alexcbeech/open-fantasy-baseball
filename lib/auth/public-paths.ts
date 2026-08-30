const exactPublicPagePaths = new Set(["/api-docs"]);
const exactPublicAssetPaths = new Set([
  "/favicon.ico",
  "/icon.svg",
  "/manifest.webmanifest",
  "/offline.html",
  "/offline.css",
  "/sw.js",
]);
const publicAssetPrefixes = ["/_next/static/", "/_next/image", "/brand/", "/icons/"];

/** Pages that must remain reachable before a user has authenticated. */
export function isPublicPagePath(pathname: string): boolean {
  return (
    exactPublicPagePaths.has(pathname) ||
    pathname === "/join" ||
    pathname.startsWith("/join/")
  );
}

/** Install metadata and static assets that must never be replaced by auth HTML. */
export function isPublicAssetPath(pathname: string): boolean {
  return exactPublicAssetPaths.has(pathname) || publicAssetPrefixes.some((prefix) => pathname.startsWith(prefix));
}
