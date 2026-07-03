"use client";

import { useState } from "react";

type PlayerAvatarProps = {
  mlbPlayerId?: number | null;
  name: string;
  size?: "sm" | "md";
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

/**
 * Circular player headshot from MLB's public image CDN, with a graceful
 * initials fallback when the id is missing or the image fails to load.
 */
export function PlayerAvatar({ mlbPlayerId, name, size = "md" }: PlayerAvatarProps) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(mlbPlayerId) && !failed;

  return (
    <span className={`player-avatar player-avatar-${size}`} aria-hidden="true">
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://midfield.mlbstatic.com/v1/people/${mlbPlayerId}/spots/120`}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="player-avatar-fallback">{initials(name)}</span>
      )}
    </span>
  );
}
