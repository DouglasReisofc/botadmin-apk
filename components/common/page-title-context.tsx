"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type PageTitleContextValue = {
  title: string | null;
  subtitle: string | null;
  setTitle: (value: string | null) => void;
  setSubtitle: (value: string | null) => void;
};

const PageTitleContext = createContext<PageTitleContextValue | undefined>(undefined);

export const PageTitleProvider = ({ children }: { children: ReactNode }) => {
  const [title, setTitleState] = useState<string | null>(null);
  const [subtitle, setSubtitleState] = useState<string | null>(null);

  const setTitle = useCallback((value: string | null) => {
    setTitleState(value && value.trim().length > 0 ? value.trim() : null);
  }, []);

  const setSubtitle = useCallback((value: string | null) => {
    setSubtitleState(value && value.trim().length > 0 ? value.trim() : null);
  }, []);

  const value = useMemo(
    () => ({
      title,
      subtitle,
      setTitle,
      setSubtitle,
    }),
    [title, subtitle, setTitle, setSubtitle],
  );

  return <PageTitleContext.Provider value={value}>{children}</PageTitleContext.Provider>;
};

export const usePageTitle = () => {
  const context = useContext(PageTitleContext);
  if (!context) {
    throw new Error("usePageTitle must be used within PageTitleProvider");
  }
  return context;
};
