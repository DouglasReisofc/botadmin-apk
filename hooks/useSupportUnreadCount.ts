"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "support-unread-counts";

const readTotalCount = (): number => {
  if (typeof window === "undefined") {
    return 0;
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return 0;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return 0;
    }
    return Object.values(parsed).reduce((sum, value) => {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return sum + value;
      }
      return sum;
    }, 0);
  } catch {
    return 0;
  }
};

const useSupportUnreadCount = (enabled: boolean): number => {
  const [count, setCount] = useState(() => (enabled ? readTotalCount() : 0));

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const update = () => {
      setCount(readTotalCount());
    };

    update();

    const handleCounts = (event: Event) => {
      const detail = (event as CustomEvent<{ counts?: Record<string, number> }>).detail;
      if (detail && typeof detail === "object" && detail.counts) {
        setCount(
          Object.values(detail.counts).reduce((sum, value) => {
            if (typeof value === "number" && Number.isFinite(value) && value > 0) {
              return sum + value;
            }
            return sum;
          }, 0),
        );
      } else {
        update();
      }
    };

    const handleMessage = () => update();

    window.addEventListener("support:unread-counts", handleCounts as EventListener);
    window.addEventListener("support:message-created", handleMessage as EventListener);
    window.addEventListener("support:thread-opened", handleMessage as EventListener);

    return () => {
      window.removeEventListener("support:unread-counts", handleCounts as EventListener);
      window.removeEventListener("support:message-created", handleMessage as EventListener);
      window.removeEventListener("support:thread-opened", handleMessage as EventListener);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
    }
  }, [enabled]);

  return count;
};

export default useSupportUnreadCount;
