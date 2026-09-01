"use client";

import { useEffect, useRef } from "react";
import type { AnimationItem } from "lottie-web";

type LottieAnimationProps = {
  path: string;
  title: string;
  className?: string;
  /** Carrega assim que entra na viewport (hero / above the fold). */
  eager?: boolean;
};

const LottieAnimation = ({ path, title, className, eager = false }: LottieAnimationProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    let cancelled = false;
    let animation: AnimationItem | null = null;
    let timeoutId: ReturnType<typeof window.setTimeout> | null = null;
    let idleCallbackId: number | null = null;
    let observer: IntersectionObserver | null = null;

    const loadAnimation = async () => {
      const lottie = (await import("lottie-web")).default;
      if (cancelled || !containerRef.current) return;

      animation = lottie.loadAnimation({
        container: containerRef.current,
        renderer: "svg",
        loop: true,
        autoplay: true,
        path,
        rendererSettings: {
          preserveAspectRatio: "xMidYMid meet",
        },
      });
    };

    const scheduleAnimation = () => {
      if (timeoutId || idleCallbackId !== null || animation) return;

      if (eager) {
        void loadAnimation();
        return;
      }

      timeoutId = window.setTimeout(() => {
        if ("requestIdleCallback" in window) {
          idleCallbackId = window.requestIdleCallback(() => {
            void loadAnimation();
          }, { timeout: 3000 });
          return;
        }

        void loadAnimation();
      }, 6500);
    };

    const startWhenReady = () => {
      if (!containerRef.current) return;

      if ("IntersectionObserver" in window) {
        observer = new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
              observer?.disconnect();
              scheduleAnimation();
            }
          },
          { rootMargin: "120px" },
        );
        observer.observe(containerRef.current);
        return;
      }

      scheduleAnimation();
    };

    if (document.readyState === "complete") {
      startWhenReady();
    } else {
      window.addEventListener("load", startWhenReady, { once: true });
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
      window.removeEventListener("load", startWhenReady);
      if (timeoutId) window.clearTimeout(timeoutId);
      if (idleCallbackId !== null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleCallbackId);
      }
      animation?.destroy();
    };
  }, [path]);

  return (
    <div
      ref={containerRef}
      className={className}
      role="img"
      aria-label={title}
      style={{ width: "100%", height: "100%", pointerEvents: "none", touchAction: "pan-y" }}
    />
  );
};

export default LottieAnimation;
