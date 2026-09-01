// Utility to clear support-related client storage safely
// Avoids issues when switching accounts or after logout

export function clearSupportCacheStorage() {
  try {
    if (typeof window === "undefined") return;
    // Session-scoped support keys
    try { window.sessionStorage.removeItem("support-unread-counts"); } catch {}
    try { window.sessionStorage.removeItem("support:target-thread"); } catch {}
    try { window.sessionStorage.removeItem("notifications:open-id"); } catch {}

    // Optionally notify listeners that counts are reset
    try {
      window.dispatchEvent(
        new CustomEvent("support:unread-counts", { detail: { counts: {} } }),
      );
    } catch {}
  } catch {
    // noop
  }
}

