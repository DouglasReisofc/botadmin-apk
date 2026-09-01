import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import InternalGroupInviteClient from "components/internal-group/InternalGroupInviteClient";

import { getCurrentUser } from "lib/auth";
import {
  getInternalGroupInvitePreview,
} from "lib/internal-groups";

export const dynamic = "force-dynamic";

const publicOrigin = () => {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://botadmin.shop";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname)) {
      return "https://botadmin.shop";
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "https://botadmin.shop";
  }
};

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const preview = await getInternalGroupInvitePreview(token).catch(() => null);
  if (!preview) return { title: "Convite de grupo BotAdmin" };
  const image = preview.avatarUrl
    ? new URL(preview.avatarUrl, publicOrigin()).toString()
    : new URL("/images/favicon/android-icon-192x192.png", publicOrigin()).toString();
  const description = preview.description?.trim() || `Entre no grupo BotAdmin${preview.memberCount ? ` com ${preview.memberCount} membros` : ""}.`;
  return {
    title: `${preview.name} | Grupo BotAdmin`,
    description,
    openGraph: { title: preview.name, description, type: "website", images: [{ url: image, width: 512, height: 512, alt: preview.name }] },
    twitter: { card: "summary", title: preview.name, description, images: [image] },
  };
}

export default async function InternalGroupInvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ prepared?: string }> }) {
  const { token } = await params;
  const prepared = (await searchParams).prepared === "1";
  const preview = await getInternalGroupInvitePreview(token).catch(() => null);
  if (!preview) return <InviteShell title="Convite indisponível" message="Este link expirou, foi revogado ou não existe mais." />;

  const user = await getCurrentUser();
  if (user) {
    redirect(`/api/internal-groups/invite/consume?token=${encodeURIComponent(token)}`);
  }

  // A Server Component cannot mutate cookies directly. The preparation route
  // creates the durable pending-intent cookie and redirects back once.
  if (!prepared) {
    redirect(`/api/internal-groups/invite/prepare?token=${encodeURIComponent(token)}`);
  }

  // Render the conversation surface first. Authentication is a lightweight
  // gate inside that surface, so an invite never lands on the profile setup
  // screen or asks the visitor to find the group again.
  return <InternalGroupInviteClient token={token} preview={preview} />;
}

function InviteShell({ title, message }: { title: string; message: string }) {
  return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, background: "#fff", colorScheme: "light" }}><section style={{ width: "min(440px, calc(100vw - 32px))", boxSizing: "border-box", background: "#fff", border: "1px solid #e2e8eb", borderRadius: 20, padding: 28, textAlign: "center", boxShadow: "0 12px 40px rgba(15,32,39,.12)" }}><h1 style={{ color: "#172026" }}>{title}</h1><p style={{ color: "#5d6b73", lineHeight: 1.5 }}>{message}</p><Link href="/dashboard/user" style={{ color: "#008069", fontWeight: 700 }}>Voltar ao BotAdmin</Link></section></main>;
}
