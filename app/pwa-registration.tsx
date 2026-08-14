"use client";

import { useEffect } from "react";

const SERVICE_WORKER_URL = "/sw.js";

export function PwaRegistration() {
  useEffect(() => {
    // A production service worker interferes with HMR and can leave development
    // builds serving stale chunks, so only install it in production.
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) {
      return;
    }

    const register = () => {
      navigator.serviceWorker
        .register(SERVICE_WORKER_URL, { scope: "/", updateViaCache: "none" })
        .catch(() => undefined);
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
