export const META_TEMPLATE_CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;

export const META_TEMPLATE_LIMITS = {
  header: 60,
  body: 1024,
  footer: 60,
  buttonText: 25,
  buttonCount: 3,
} as const;

export const META_MEDIA_KIND_MIME_MAP = {
  image: ["image/jpeg", "image/png", "image/webp"],
  video: ["video/mp4", "video/3gpp"],
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
} as const;

export const META_MEDIA_KIND_LABEL: Record<keyof typeof META_MEDIA_KIND_MIME_MAP, string> = {
  image: "Imagem",
  video: "Vídeo",
  document: "Documento",
};

export type MetaTemplateCategory = (typeof META_TEMPLATE_CATEGORIES)[number];

export type MetaTemplateButton = {
  type: string;
  text?: string;
  url?: string;
  phone_number?: string;
  example?: unknown;
  [key: string]: unknown;
};

export type MetaTemplateComponent = {
  type?: string;
  format?: string;
  text?: string;
  example?: unknown;
  buttons?: MetaTemplateButton[];
  [key: string]: unknown;
};

export interface AdminMetaTemplate {
  id: number;
  templateId: string;
  name: string;
  language: string;
  category: string | null;
  status: string;
  qualityScore: string | null;
  rejectedReason: string | null;
  components: MetaTemplateComponent[];
  componentsRaw: string | null;
  metaCreatedAt: string | null;
  metaUpdatedAt: string | null;
  lastSyncedAt: string | null;
  businessAccountId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TemplateMediaKind = keyof typeof META_MEDIA_KIND_MIME_MAP;

export type TemplateMediaUpload = {
  uploadId: string;
  handle: string;
  kind: TemplateMediaKind;
  mimeType: string;
  fileName: string;
  fileSize: number;
  previewUrl: string | null;
  createdAt: string;
};

export type AdminMetaTemplateCreatePayload = {
  name: string;
  language: string;
  category: MetaTemplateCategory;
  headerType?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | null;
  header?: string | null;
  headerMediaHandle?: string | null;
  body: string;
  footer?: string | null;
  buttons?: MetaTemplateButtonInput[];
};

export type AdminMetaTemplateUpdatePayload = {
  name?: string;
  language: string;
  category: MetaTemplateCategory;
  headerType?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | null;
  header?: string | null;
  headerMediaHandle?: string | null;
  body: string;
  footer?: string | null;
  buttons?: MetaTemplateButtonInput[];
  preserveHeader?: boolean;
  preserveButtons?: boolean;
};

export type MetaTemplateButtonInput =
  | {
      kind: "quick_reply";
      text: string;
    }
  | {
      kind: "url";
      text: string;
      url: string;
      example?: string | null;
    }
  | {
      kind: "phone";
      text: string;
      phoneNumber: string;
    };
