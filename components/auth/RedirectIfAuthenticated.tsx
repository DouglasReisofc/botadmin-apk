"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type RedirectIfAuthenticatedProps = {
  isAuthenticated: boolean;
  redirectTo?: string;
};

const RedirectIfAuthenticated = ({
  isAuthenticated,
  redirectTo = "/dashboard/user",
}: RedirectIfAuthenticatedProps) => {
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated) {
      router.replace(redirectTo);
    }
  }, [isAuthenticated, redirectTo, router]);

  return null;
};

export default RedirectIfAuthenticated;
