import type { Metadata, Viewport } from "next";
import { getCurrentOfbUserOrDemo } from "@/lib/auth/neon-auth";
import { getProfilePreferences } from "@/lib/data/profile";
import "./globals.css";

export const metadata: Metadata = {
  title: "Open Fantasy Baseball",
  description: "A mobile-first open fantasy baseball commissioner and team management app.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b6b63",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const currentUser = await getCurrentOfbUserOrDemo();
  const profile = await getProfilePreferences(currentUser.email);

  return (
    <html lang="en" data-theme={profile.displayMode} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
