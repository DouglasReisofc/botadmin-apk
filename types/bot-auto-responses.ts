export type BotAutoResponseMedia = {
  mediaType: "image" | "video" | "audio" | "document" | "sticker";
  url: string | null;
  path: string | null;
  fileName: string | null;
  mimeType: string | null;
  caption: string | null;
};

export type BotAutoResponseVcard = {
  name: string;
  phone: string | null;
  organization: string | null;
  email: string | null;
  vcard: string;
};

export type BotAutoResponseReplyButton = {
  id: string;
  text: string;
};

export type BotAutoResponseCtaButton = {
  id: string;
  text: string;
  type: "cta_url" | "cta_call" | "cta_copy";
  url?: string | null;
  urlSource?: "manual" | "group_invite" | null;
  groupId?: number | null;
  phoneNumber?: string | null;
  copyCode?: string | null;
};

export type BotAutoResponseButtons =
  | {
      type: "button_reply";
      title?: string | null;
      body?: string | null;
      footer?: string | null;
      buttons: BotAutoResponseReplyButton[];
    }
  | {
      type: "button_cta";
      title?: string | null;
      body?: string | null;
      footer?: string | null;
      buttons: BotAutoResponseCtaButton[];
    };

export type BotAutoResponse = {
  id: string;
  triggers: string[];
  responseText: string;
  matchMode: "contains" | "equals";
  matchAnyMessage?: boolean;
  perContactLimit?: number | null;
  responseMedia: BotAutoResponseMedia | null;
  responseVcard: BotAutoResponseVcard | null;
  responseButtons?: BotAutoResponseButtons | null;
  createdAt: string;
  updatedAt: string;
};
