"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export type TopbarMenuItem = {
  href: string;
  label: string;
};

/**
 * Collapses the topbar's secondary destinations behind one button so the bar
 * stays a single row on phones (the icon row used to wrap). The trigger is a
 * real menu — closes on outside tap, Escape, or choosing an item.
 */
export function TopbarMenu({ items }: { items: TopbarMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="topbar-menu" ref={containerRef}>
      <button
        className="icon-button"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open menu"
        onClick={() => setOpen((value) => !value)}
      >
        &#8943;
      </button>
      {open ? (
        <div className="topbar-menu-panel" role="menu" aria-label="Site menu">
          {items.map((item) => (
            <Link
              className="topbar-menu-item"
              role="menuitem"
              href={item.href}
              key={item.href}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
