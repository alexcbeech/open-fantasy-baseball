import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Open Fantasy Baseball",
    short_name: "OFB",
    description: "Manage fantasy baseball teams, lineups, matchups, drafts, trades, and waivers.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#eaeef4",
    theme_color: "#14213d",
    categories: ["sports"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "My Teams",
        short_name: "Teams",
        description: "Open your fantasy baseball teams.",
        url: "/",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Profile & Notifications",
        short_name: "Profile",
        description: "Manage your profile and notification preferences.",
        url: "/profile",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
