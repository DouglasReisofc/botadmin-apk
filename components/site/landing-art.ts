/** Replace only the retired artwork. Future administrator uploads still win. */
export function landingArtwork(value: string | null | undefined, kind: "hero" | "community") {
  const retired = new Set([
    "/images/png/dasher-ai.png",
    "/images/png/botadmin-workflow.jpg",
    "/uploads/admin/homepage/1760995233742-8ab0dba1c5dcc240.webp",
    "/uploads/admin/homepage/1760747322293-18672a94b70c19c8.webp",
  ]);
  const configured = value?.trim();
  if (configured) {
    try {
      const url = new URL(configured, "https://botadmin.shop");
      if (url.origin !== "https://botadmin.shop" || !retired.has(url.pathname)) return configured;
    } catch { /* Invalid saved artwork falls back to the packaged illustration. */ }
  }
  return `/botadmin-landing/botadmin-${kind}-v2.webp`;
}
