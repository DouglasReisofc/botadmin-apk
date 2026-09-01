import type { Metadata } from "next";
import Link from "next/link";

import { getSharedBotFlowPackage } from "lib/bot-flow-sharing";

export const metadata: Metadata = {
  title: "Importar fluxo | BotAdmin",
  description: "Abra um fluxo compartilhado e importe para sua conta BotAdmin.",
};

type ShareFlowPageSearchParams =
  Promise<Record<string, string | string[] | undefined>>;

const resolveSearchParams = async (
  searchParams: ShareFlowPageSearchParams | undefined,
): Promise<Record<string, string | string[] | undefined>> => {
  if (!searchParams) return {};
  try {
    return await searchParams;
  } catch {
    return {};
  }
};

const readSingleParam = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) return value[0] ?? "";
  return typeof value === "string" ? value : "";
};

const ShareFlowPage = async ({ searchParams }: { searchParams?: ShareFlowPageSearchParams }) => {
  const params = await resolveSearchParams(searchParams);
  const code = readSingleParam(params.share_code || params.flow_share || params.code).trim();
  const shared = code ? await getSharedBotFlowPackage(code).catch(() => null) : null;
  const importHref = `/dashboard/user?section=flows&flow_share=${encodeURIComponent(code)}`;

  return (
    <main style={{
      minHeight: "100dvh",
      display: "grid",
      placeItems: "center",
      padding: 20,
      background: "linear-gradient(135deg, #f7faf9 0%, #e8fff6 100%)",
      color: "#0f172a",
      fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      <section style={{
        width: "min(520px, 100%)",
        border: "1px solid rgba(20, 184, 166, 0.22)",
        borderRadius: 22,
        padding: 24,
        display: "grid",
        gap: 16,
        background: "#fff",
        boxShadow: "0 24px 70px rgba(15, 23, 42, 0.12)",
      }}>
        <span style={{
          width: 54,
          height: 54,
          borderRadius: 18,
          display: "grid",
          placeItems: "center",
          background: "#14c997",
          color: "#fff",
          fontSize: 24,
          fontWeight: 900,
        }}>
          ↗
        </span>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.1 }}>Fluxo compartilhado</h1>
          <p style={{ margin: "8px 0 0", color: "#64748b", lineHeight: 1.5 }}>
            {shared
              ? `Importe "${shared.package.flow.name}" para editar e usar na sua conta.`
              : "Esse link será aberto no importador de fluxos do BotAdmin."}
          </p>
        </div>
        {shared ? (
          <div style={{
            border: "1px solid #dbe7ef",
            borderRadius: 16,
            padding: 14,
            display: "grid",
            gap: 8,
            background: "#f8fafc",
          }}>
            <strong>{shared.package.flow.name}</strong>
            <small style={{ color: "#64748b" }}>
              /{shared.package.flow.command} · {shared.package.meta.nodeCount} blocos · {shared.package.meta.edgeCount} conexões
            </small>
          </div>
        ) : null}
        <Link href={importHref} style={{
          minHeight: 46,
          borderRadius: 999,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 18px",
          background: "#14c997",
          color: "#fff",
          textDecoration: "none",
          fontWeight: 900,
          boxShadow: "0 14px 28px rgba(20, 201, 151, 0.24)",
        }}>
          Importar no BotAdmin
        </Link>
        <small style={{ color: "#64748b", overflowWrap: "anywhere" }}>
          Código: {code || "não informado"}
        </small>
      </section>
    </main>
  );
};

export default ShareFlowPage;
