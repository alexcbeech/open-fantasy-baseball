"use client";

import { useLayoutEffect } from "react";

/**
 * Reference-counted body scroll lock shared by every overlay (bottom sheets,
 * the feedback panel). Uses the position:fixed technique because plain
 * `overflow: hidden` does not stop touch scrolling on iOS Safari; the saved
 * scroll offset is restored when the last overlay unmounts.
 */
let lockCount = 0;
let savedScrollY = 0;

function lockBody() {
  if (lockCount === 0) {
    savedScrollY = window.scrollY;
    const { style } = document.body;
    style.position = "fixed";
    style.top = `-${savedScrollY}px`;
    style.left = "0";
    style.right = "0";
    style.width = "100%";
    style.overflow = "hidden";
  }
  lockCount += 1;
}

function unlockBody() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    const { style } = document.body;
    style.position = "";
    style.top = "";
    style.left = "";
    style.right = "";
    style.width = "";
    style.overflow = "";
    window.scrollTo(0, savedScrollY);
  }
}

export function useBodyScrollLock(active = true) {
  useLayoutEffect(() => {
    if (!active) {
      return;
    }
    lockBody();
    return unlockBody;
  }, [active]);
}
