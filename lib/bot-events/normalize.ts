import { NormalizedWebhookPayload } from "./types";

const TYPE_ALIASES: Record<string, string> = {
  message: "message.upsert",
  "message.upsert": "message.upsert",
  "message.received": "message.upsert",
  "message.undecryptable": "message.upsert",
  messages: "message.upsert",
  "messages.upsert": "message.upsert",
  receipt: "messages.update",
  readreceipt: "messages.update",
  "message.receipt": "messages.update",
  "messages.update": "messages.update",
  chataction: "chat.action",
  "chat.action": "chat.action",
  "chat.archived": "chat.action",
  "chat.unarchived": "chat.action",
  "chat.pinned": "chat.action",
  "chat.unpinned": "chat.action",
  "chat.cleared": "chat.action",
  "chat.deleted": "chat.action",
  messageaction: "message.action",
  "message.action": "message.action",
  "message.deleted": "message.action",
  connected: "instance.status",
  disconnected: "instance.status",
  connectfailure: "instance.status",
  "connect.failure": "instance.status",
  keepaliverestored: "instance.status",
  "keepalive.restored": "instance.status",
  keepalivetimeout: "instance.status",
  "keepalive.timeout": "instance.status",
  loggedout: "instance.status",
  "logged.out": "instance.status",
  clientoutdated: "instance.status",
  "client.outdated": "instance.status",
  temporaryban: "instance.status",
  "temporary.ban": "instance.status",
  streamerror: "instance.status",
  "stream.error": "instance.status",
  streamreplaced: "instance.status",
  "stream.replaced": "instance.status",
  pairsuccess: "instance.status",
  "pair.success": "instance.status",
  pairerror: "instance.status",
  "pair.error": "instance.status",
  qr: "instance.status",
  status: "status.update",
  "status.received": "status.update",
  "status.created": "status.update",
  "status.deleted": "status.update",
  "status.edited": "status.update",
  "status.viewed": "status.update",
  "status.delivered": "status.update",
  "status.receipt": "status.update",
  calloffer: "call.update",
  "call.offer": "call.update",
  callaccept: "call.update",
  "call.accept": "call.update",
  callreject: "call.update",
  "call.reject": "call.update",
  callterminate: "call.update",
  "call.terminate": "call.update",
  calloffernotice: "call.update",
  "call.offer.notice": "call.update",
  callrelaylatency: "call.update",
  "call.relay.latency": "call.update",
  "call.update": "call.update",
  presence: "presence.update",
  "presence.user": "presence.update",
  "presence.chat": "presence.update",
  historysync: "history.sync",
  "history.sync": "history.sync",
  groupinfo: "group.info",
  "group.updated": "group.info",
  joinedgroup: "group.joined",
  "group.joined": "group.joined",
  picture: "group.picture",
  "group.picture.updated": "group.picture",
  photo: "group.picture",
  image: "group.picture",
  "group.photo": "group.picture",
  groupphoto: "group.picture",
  grouppicture: "group.picture",
  "group_picture": "group.picture",
  "group_profile_picture": "group.picture",
  "group_profile_photo": "group.picture",
  profilepicture: "group.picture",
  "picture.update": "group.picture",
  groupupdate: "group.update",
  privacysettings: "privacy.settings",
  "privacy.settings": "privacy.settings",
  privacy: "privacy.settings",
  pushnamesetting: "pushname.setting",
  "pushname.setting": "pushname.setting",
  pushname: "pushname.setting",
};

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const resolveType = (raw: Record<string, unknown>): string => {
	const candidates: unknown[] = [];

	if (typeof raw.eventType === "string") candidates.push(raw.eventType);
	if (typeof raw.event_type === "string") candidates.push(raw.event_type);
	if (typeof raw.type === "string") candidates.push(raw.type);
	if (typeof raw.Type === "string") candidates.push(raw.Type);

	const resolved =
		candidates
      .map((candidate) => String(candidate).trim())
      .find((candidate) => candidate.length > 0) ?? "message.upsert";

  const lowered = resolved.toLowerCase();
  return TYPE_ALIASES[lowered] ?? lowered;
};

const resolveData = (raw: Record<string, unknown>): Record<string, unknown> => {
	const isStandardEasyzapEnvelope =
	    typeof raw.schemaVersion === "string" ||
	    typeof raw.eventType === "string" ||
	    toRecord(raw.instance).id !== undefined;

	if (isStandardEasyzapEnvelope) {
		return raw;
	}

	const eventRecord = raw.event && typeof raw.event === "object" ? (raw.event as Record<string, unknown>) : null;
	const dataRecord = raw.data && typeof raw.data === "object" ? (raw.data as Record<string, unknown>) : null;

  if (eventRecord && Object.keys(eventRecord).length > 0) {
    return eventRecord;
  }

  if (dataRecord && Object.keys(dataRecord).length > 0) {
    return dataRecord;
  }

  const payloadRecord =
    raw.payload && typeof raw.payload === "object" ? (raw.payload as Record<string, unknown>) : null;
  if (payloadRecord && Object.keys(payloadRecord).length > 0) {
    return payloadRecord;
  }

  const bodyRecord = raw.body && typeof raw.body === "object" ? (raw.body as Record<string, unknown>) : null;
  if (bodyRecord && Object.keys(bodyRecord).length > 0) {
    return bodyRecord;
  }

  return raw;
};

const normalizeBearerToken = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const bearer = trimmed.match(/^bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || trimmed;
};

const resolveInstance = (
  raw: Record<string, unknown>,
  data: Record<string, unknown>,
): Record<string, unknown> | null => {
  const candidates = [
    raw.instance,
    raw.Instance,
    raw.botInstance,
    raw.BotInstance,
    data.instance,
    data.Instance,
    data.botInstance,
    data.BotInstance,
  ];
  for (const candidate of candidates) {
    const record = toRecord(candidate);
    if (Object.keys(record).length > 0) {
      return record;
    }
  }
  return null;
};

const resolveToken = (
  raw: Record<string, unknown>,
  data: Record<string, unknown>,
  instance: Record<string, unknown> | null,
): string | null => {
  const candidates = [
    raw.token,
    raw.Token,
    raw.apikey,
    raw.apiKey,
    raw.api_key,
    raw.key,
    raw.authorization,
    raw.Authorization,
    data.token,
    data.Token,
    data.apikey,
    data.apiKey,
    data.api_key,
    data.key,
    data.authorization,
    data.Authorization,
    instance?.token,
    instance?.Token,
    instance?.apikey,
    instance?.apiKey,
    instance?.api_key,
    instance?.key,
  ];

  for (const candidate of candidates) {
    const token = normalizeBearerToken(candidate);
    if (token) {
      return token;
    }
  }
  return null;
};

export const normalizeWebhookPayload = (payload: unknown): NormalizedWebhookPayload => {
  const raw = toRecord(payload);
  const type = resolveType(raw);
  const data = resolveData(raw);
  const instance = resolveInstance(raw, data);
  const token = resolveToken(raw, data, instance);

  return {
    raw,
    type,
    event: type,
    data,
    token,
    instance,
  };
};
