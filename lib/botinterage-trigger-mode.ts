export const resolveBotInterageMentionOnly = (
  featureFlags: Record<string, boolean | undefined>,
): boolean => {
  const explicit = featureFlags.botInterageMentionOnly;
  if (typeof explicit === "boolean") return explicit;
  return (
    featureFlags.iaSomenteMencao === true ||
    featureFlags.iaConversas === false
  );
};
