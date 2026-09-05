"use client";

import { useState } from "react";

export function IdentityImage({ url, name, size = "small" }: { url?: string | null; name: string; size?: "small" | "large" }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initials = name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  return <span className={`identity-image identity-image--${size}`} aria-hidden="true">
    {url && failedUrl !== url
      // Already bounded and compressed on upload; avoid a second image proxy/cache.
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={url} alt="" width={size === "large" ? 64 : 28} height={size === "large" ? 64 : 28} onError={() => setFailedUrl(url)} />
      : <span>{initials || "?"}</span>}
  </span>;
}
