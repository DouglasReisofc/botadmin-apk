export type SupportNotificationContext = {
  direction: "inbound" | "outbound";
  hasPreviousMessage: boolean;
  isAdminThread: boolean;
  senderRole: "user" | "admin" | "contact" | "system";
};

/**
 * A support-opened notification belongs only to a real external contact that
 * starts a new customer conversation. Internal user <-> admin conversations
 * are regular chats and must never look like a support request to the user.
 */
export const shouldNotifySupportOpened = ({
  direction,
  hasPreviousMessage,
  isAdminThread,
  senderRole,
}: SupportNotificationContext): boolean =>
  direction === "inbound" &&
  !hasPreviousMessage &&
  !isAdminThread &&
  senderRole === "contact";
