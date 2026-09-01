"use client";

import { useEffect } from "react";
import { usePageTitle } from "./page-title-context";

type Props = {
  title?: string | null;
  subtitle?: string | null;
};

const DashboardPageTitle = ({ title = null, subtitle = null }: Props) => {
  const { setTitle, setSubtitle } = usePageTitle();

  useEffect(() => {
    setTitle(title);
    setSubtitle(subtitle);
    return () => {
      setTitle(null);
      setSubtitle(null);
    };
  }, [title, subtitle, setTitle, setSubtitle]);

  return null;
};

export default DashboardPageTitle;
