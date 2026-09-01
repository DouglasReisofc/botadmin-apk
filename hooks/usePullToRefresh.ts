"use client";

import { useEffect, useRef } from "react";

type UsePullToRefreshOptions = {
  threshold?: number;
  onRefresh?: () => void | Promise<void>;
  enabled?: boolean;
};

const defaultRefresh = () => {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
};

export const usePullToRefresh = (options: UsePullToRefreshOptions = {}) => {
  const refreshingRef = useRef(false);
  const {
    threshold = 80,
    onRefresh = defaultRefresh,
    enabled = true,
  } = options;

  useEffect(() => {
    if (typeof window === "undefined" || !enabled) {
      return;
    }

    let startY = 0;
    let isTracking = false;
    let hasTriggered = false;

    const handleTouchStart = (event: TouchEvent) => {
      if (window.scrollY > 0) {
        return;
      }

      const target = event.target;
      if (target instanceof Element) {
        let current: Element | null = target;

        while (current && current !== document.body) {
          const style = window.getComputedStyle(current);
          const isScrollable =
            (style.overflowY === "auto" || style.overflowY === "scroll") &&
            current.scrollHeight > current.clientHeight;

          if (isScrollable) {
            return;
          }

          current = current.parentElement;
        }
      }

      const touch = event.touches[0];
      startY = touch.clientY;
      isTracking = true;
      hasTriggered = false;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!isTracking || refreshingRef.current) {
        return;
      }

      const touch = event.touches[0];
      const delta = touch.clientY - startY;

      if (delta > threshold && !hasTriggered) {
        hasTriggered = true;
        refreshingRef.current = true;
        Promise.resolve(onRefresh()).finally(() => {
          refreshingRef.current = false;
        });
      }
    };

    const handleTouchEnd = () => {
      isTracking = false;
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [enabled, onRefresh, threshold]);
};
