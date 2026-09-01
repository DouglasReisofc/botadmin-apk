export type BotFlowScope = "group" | "private" | "both";

export type BotFlowTriggerType = "command" | "keyword" | "message" | "media" | "button" | "webhook";

export type BotFlowMatchMode = "exact" | "contains" | "starts_with";

export type BotFlowTriggerMediaType = "any" | "image" | "video" | "audio" | "document" | "sticker" | "vcard";

export type BotFlowNodeKind =
  | "trigger"
  | "content"
  | "menu"
  | "action"
  | "webhook_wait"
  | "text"
  | "media"
  | "buttons"
  | "delay"
  | "condition"
  | "flow_link"
  | "randomizer"
  | "smart_delay"
  | "integration"
  | "assistant_gpt"
  | "set_variable"
  | "http_request"
  | "capture"
  | "jump";

export type BotFlowButtonKind = "reply" | "url" | "call" | "copy";

export type BotFlowButton = {
  id: string;
  type: BotFlowButtonKind;
  label: string;
  value: string;
};

export type BotFlowContentItemType =
  | "text"
  | "image"
  | "video"
  | "file"
  | "audio"
  | "save"
  | "delay"
  | "auto_off"
  | "contact";

export type BotFlowContentItem = {
  id: string;
  type: BotFlowContentItemType;
  text?: string;
  caption?: string;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "audio" | "document";
  variableName?: string;
  variableValue?: string;
  delaySeconds?: number;
  contactName?: string;
  contactPhone?: string;
};

export type BotFlowMenuMode = "list" | "number" | "buttons";

export type BotFlowMenuOption = {
  id: string;
  label: string;
  value: string;
  description?: string;
};

export type BotFlowActionType =
  | "add_tag"
  | "remove_tag"
  | "custom_event"
  | "subscribe_sequence"
  | "unsubscribe_sequence"
  | "set_field"
  | "clear_field"
  | "open_chat"
  | "assign_chat"
  | "notify_team"
  | "unassign_chat"
  | "complete_chat"
  | "pause_automation"
  | "restart_automation"
  | "clear_gpt_thread";

export type BotFlowAction = {
  id: string;
  type: BotFlowActionType;
  label?: string;
  key?: string;
  value?: string;
};

export type BotFlowRandomizerMode = "random" | "sequential";

export type BotFlowRandomizerOption = {
  id: string;
  label: string;
  weight: number;
};

export type BotFlowConditionOperator =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "starts_with"
  | "ends_with"
  | "greater_than"
  | "less_than"
  | "matches_regex"
  | "not_matches_regex"
  | "is_set"
  | "is_empty";

export type BotFlowConditionRule = {
  id: string;
  variable: string;
  operator: BotFlowConditionOperator;
  value: string;
};

export type BotFlowVariableOperation = "set" | "clear" | "append";

export type BotFlowHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type BotFlowHttpHeader = {
  id: string;
  key: string;
  value: string;
};

export type BotFlowHttpParam = {
  id: string;
  key: string;
  value: string;
};

export type BotFlowHttpResponseMapping = {
  id: string;
  path: string;
  variable: string;
};

export type BotFlowDatabaseProvider = "mysql" | "postgres";

export type BotFlowDatabaseOperation = "query" | "select" | "insert" | "update" | "delete";

export type BotFlowCaptureType =
  | "text"
  | "email"
  | "number"
  | "phone"
  | "website"
  | "date"
  | "time"
  | "media";

export type BotFlowNode = {
  id: string;
  kind: BotFlowNodeKind;
  title: string;
  x: number;
  y: number;
  stackId?: string;
  stackOrder?: number;
  stackTitle?: string;
  text?: string;
  headerTitle?: string;
  footerText?: string;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "audio" | "document";
  contentItems?: BotFlowContentItem[];
  menuMode?: BotFlowMenuMode;
  menuInvalidText?: string;
  menuErrorLimit?: number;
  menuOptions?: BotFlowMenuOption[];
  actions?: BotFlowAction[];
  delaySeconds?: number;
  smartDelayMode?: "relative" | "datetime";
  smartDelayUnit?: "seconds" | "minutes" | "hours" | "days";
  smartDelayUntil?: string;
  randomizerMode?: BotFlowRandomizerMode;
  randomizerOptions?: BotFlowRandomizerOption[];
  targetFlowId?: number | null;
  targetFlowName?: string;
  assistantName?: string;
  assistantInitialMessage?: string;
  assistantInitialMode?: "contact" | "assistant";
  assistantLanguage?: string;
  assistantTemperature?: number;
  assistantInstructions?: string;
  assistantIndividualInstructions?: string;
  assistantErrorMessage?: string;
  assistantModel?: string;
  assistantContext?: string;
  sendDelaySeconds?: number;
  showTyping?: boolean;
  showRecording?: boolean;
  buttons?: BotFlowButton[];
  conditionVariable?: string;
  conditionOperator?: BotFlowConditionOperator;
  conditionValue?: string;
  conditionLogic?: "AND" | "OR";
  conditionRules?: BotFlowConditionRule[];
  variableName?: string;
  variableValue?: string;
  variableOperation?: BotFlowVariableOperation;
  httpMethod?: BotFlowHttpMethod;
  httpUrl?: string;
  httpQueryParams?: BotFlowHttpParam[];
  httpHeaders?: BotFlowHttpHeader[];
  httpBody?: string;
  httpTimeoutSeconds?: number;
  httpSaveStatusVariable?: string;
  httpSaveBodyVariable?: string;
  httpResponseMappings?: BotFlowHttpResponseMapping[];
  databaseProvider?: BotFlowDatabaseProvider;
  databaseOperation?: BotFlowDatabaseOperation;
  databaseHost?: string;
  databasePort?: number;
  databaseName?: string;
  databaseUser?: string;
  databasePassword?: string;
  databaseSsl?: boolean;
  databaseTable?: string;
  databaseQuery?: string;
  databaseValuesJson?: string;
  databaseSaveResultVariable?: string;
  databaseResponseMappings?: BotFlowHttpResponseMapping[];
  webhookResponseMappings?: BotFlowHttpResponseMapping[];
  captureType?: BotFlowCaptureType;
  captureVariable?: string;
  captureFallbackText?: string;
  jumpTargetNodeId?: string;
  triggerType?: BotFlowTriggerType;
  triggerMatchMode?: BotFlowMatchMode;
  triggerValue?: string;
  triggerMediaType?: BotFlowTriggerMediaType;
};

export type BotFlowEdge = {
  id: string;
  from: string;
  to: string;
  branch?: "default" | "true" | "false" | "invalid" | `button:${string}` | `menu:${string}` | `random:${string}`;
  label?: string;
};

export type BotFlow = {
  id: number;
  userId: number;
  scope: BotFlowScope;
  instanceId: number | null;
  groupId: number | null;
  name: string;
  command: string;
  triggerType: BotFlowTriggerType;
  matchMode: BotFlowMatchMode;
  enabled: boolean;
  description: string | null;
  nodes: BotFlowNode[];
  edges: BotFlowEdge[];
  createdAt: string;
  updatedAt: string;
  revision: number;
};

export type BotFlowInput = {
  scope?: BotFlowScope;
  instanceId?: number | null;
  groupId?: number | null;
  name?: string;
  command?: string;
  triggerType?: BotFlowTriggerType;
  matchMode?: BotFlowMatchMode;
  enabled?: boolean;
  description?: string | null;
  nodes?: BotFlowNode[];
  edges?: BotFlowEdge[];
  revision?: number;
};
