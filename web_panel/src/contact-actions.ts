export type ContactActionKey =
  | "start"
  | "warn"
  | "reset_infractions"
  | "promote"
  | "demote"
  | "remove"
  | "remove_clean"
  | "ban"
  | "delete_recent"
  | "blacklist";

export type ContactActionDefinition = {
  key: ContactActionKey;
  label: string;
  description: string;
  destructive?: boolean;
};

export type ContactActionContext = {
  isGroup: boolean;
  canManage: boolean;
  isSelf: boolean;
  isBot: boolean;
  canWarn?: boolean;
  canResetInfractions?: boolean;
  canManageRoles?: boolean;
  canRemove?: boolean;
  canDeleteRecent?: boolean;
  canBlacklist?: boolean;
};

/**
 * Actions shown by the member modal.  Keeping this policy outside the JSX
 * makes the permission boundary explicit and gives the mobile/web surfaces a
 * single source of truth.
 */
export const getContactActions = (
  context: ContactActionContext,
): ContactActionDefinition[] => {
  const actions: ContactActionDefinition[] = [
    {
      key: "start",
      label: context.isGroup ? "Iniciar conversa privada" : "Iniciar conversa",
      description: "Abrir uma conversa privada com este contato.",
    },
  ];
  if (!context.isGroup || !context.canManage || context.isSelf || context.isBot)
    return actions;

  if (context.canWarn !== false) {
    actions.push({
      key: "warn",
      label: "Advertir participante",
      description: "Registrar uma advertência seguindo as regras do grupo.",
    });
  }
  if (context.canResetInfractions !== false) {
    actions.push({
      key: "reset_infractions",
      label: "Resetar advertências",
      description: "Remover as infrações acumuladas deste participante.",
    });
  }
  if (context.canManageRoles !== false) {
    actions.push(
      {
        key: "promote",
        label: "Promover administrador",
        description: "Conceder permissões de administrador no grupo.",
      },
      {
        key: "demote",
        label: "Rebaixar administrador",
        description: "Remover as permissões de administrador no grupo.",
      },
    );
  }
  if (context.canRemove !== false) {
    actions.push({
      key: "remove",
      label: "Remover do grupo",
      description: "Remover o participante sem apagar o histórico.",
      destructive: true,
    });
  }
  if (context.canRemove !== false && context.canDeleteRecent !== false) {
    actions.push({
      key: "remove_clean",
      label: "Remover e apagar recentes",
      description: "Apagar até 10 mensagens recentes antes da remoção.",
      destructive: true,
    });
  }
  if (context.canDeleteRecent !== false) {
    actions.push({
      key: "delete_recent",
      label: "Apagar mensagens recentes",
      description: "Apagar as últimas mensagens deste participante para todos.",
      destructive: true,
    });
  }
  if (context.canBlacklist !== false) {
    actions.push({
      key: "blacklist",
      label: "Adicionar à blacklist",
      description: "Bloquear o participante e removê-lo do grupo.",
      destructive: true,
    });
  }
  actions.push({
    key: "ban",
    label: "Banir do grupo",
    description: "Remover e bloquear o participante no grupo.",
    destructive: true,
  });
  return actions;
};
