"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISSED_KEY = "ofb:pwa-install-dismissed";

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

function wasDismissed() {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

function isIosDevice() {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function PwaInstallCard() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [mode, setMode] = useState<"hidden" | "prompt" | "ios">("hidden");

  useEffect(() => {
    if (isStandalone() || wasDismissed()) {
      return;
    }

    const iosTimer = isIosDevice() ? window.setTimeout(() => setMode("ios"), 0) : undefined;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
      setMode("prompt");
    };
    const onInstalled = () => {
      setPromptEvent(null);
      setMode("hidden");
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      if (iosTimer !== undefined) {
        window.clearTimeout(iosTimer);
      }
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // Storage can be unavailable in private browsing; hiding for this page is enough.
    }
    setMode("hidden");
  }

  async function install() {
    if (!promptEvent) {
      return;
    }

    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    setPromptEvent(null);
    setMode("hidden");

    if (choice.outcome === "accepted") {
      try {
        window.localStorage.setItem(DISMISSED_KEY, "true");
      } catch {
        // The app is installed even if the preference cannot be persisted.
      }
    }
  }

  if (mode === "hidden") {
    return null;
  }

  return (
    <aside className="install-card" aria-label="Install Open Fantasy Baseball">
      <Image alt="" aria-hidden height={48} src="/brand/ofb-tile.svg" width={48} />
      <div className="install-card-copy">
        <strong>Install OFB on this device</strong>
        <span>
          {mode === "ios"
            ? "Tap Share, choose Add to Home Screen, and keep Open as Web App enabled."
            : "Add OFB to your home screen for a full-screen experience and faster access."}
        </span>
      </div>
      {mode === "prompt" ? (
        <button className="primary-button install-card-action" type="button" onClick={install}>
          Install
        </button>
      ) : null}
      <button className="install-card-dismiss" type="button" onClick={dismiss} aria-label="Dismiss install suggestion">
        &times;
      </button>
    </aside>
  );
}
