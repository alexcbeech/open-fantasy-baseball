import type { Metadata, Viewport } from "next";
import { getCurrentOfbUser, getCurrentOfbUserOrDemo, isNeonAuthConfigured } from "@/lib/auth/neon-auth";
import { getProfilePreferences } from "@/lib/data/profile";
import { FeedbackWidget } from "./feedback-widget";
import { PwaRegistration } from "./pwa-registration";
import "./globals.css";

export const metadata: Metadata = {
  title: "Open Fantasy Baseball",
  description: "A mobile-first open fantasy baseball commissioner and team management app.",
  applicationName: "Open Fantasy Baseball",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "OFB",
  },
  icons: {
    icon: [
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#14213d",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const currentUser = await getCurrentOfbUserOrDemo();
  const profile = await getProfilePreferences(currentUser.email);

  // Feedback is signed-in only: always available locally (no auth configured),
  // otherwise only once a real session exists.
  const authEnabled = isNeonAuthConfigured();
  const showFeedback = !authEnabled || Boolean(await getCurrentOfbUser());

  return (
    <html lang="en" data-theme={profile.displayMode} data-time-zone={profile.timeZone} suppressHydrationWarning>
      <body>
        <PwaRegistration />
        {children}
        {showFeedback ? <FeedbackWidget /> : null}
      </body>
    </html>
  );
}
