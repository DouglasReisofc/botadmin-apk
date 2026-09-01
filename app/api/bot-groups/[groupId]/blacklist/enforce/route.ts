import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "lib/auth";
import { getGroupByIdForUser } from "lib/bot-groups";
import { getInstanceById } from "lib/bot-instances";
import { removeGroupParticipant } from "lib/wuzapi";

const sanitizeDigits = (value: string): string => value.replace(/\D/g, "").trim();

const candidateParticipants = (digits: string): string[] => {
  const normalized = sanitizeDigits(digits);
  if (!normalized) {
    return [];
  }
  const candidates = new Set<string>();
  if (digits.includes("@")) {
    candidates.add(digits.trim());
  }
  candidates.add(normalized);
  candidates.add(`${normalized}@c.us`);
  candidates.add(`${normalized}@s.whatsapp.net`);
  candidates.add(`${normalized}@lid`);
  return Array.from(candidates);
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
    }

    const { groupId: rawGroupId } = await params;
    const groupId = Number.parseInt(rawGroupId, 10);
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return NextResponse.json({ message: "Grupo inválido." }, { status: 400 });
    }

    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return NextResponse.json({ message: "Payload inválido." }, { status: 400 });
    }

    const digitsInput = Array.isArray((payload as Record<string, unknown>).digits)
      ? ((payload as Record<string, unknown>).digits as unknown[])
      : [];

    const digitsList = Array.from(
      new Set(
        digitsInput
          .map((entry) => (typeof entry === "string" ? entry : String(entry ?? "")))
          .map(sanitizeDigits)
          .filter((entry) => entry.length >= 5),
      ),
    );

    if (digitsList.length === 0) {
      return NextResponse.json({ removed: [], failed: [], message: "Nenhum número informado." });
    }

    const group = await getGroupByIdForUser(user.id, groupId);
    if (!group) {
      return NextResponse.json({ message: "Grupo não encontrado." }, { status: 404 });
    }

    if (!group.remoteId) {
      return NextResponse.json(
        { message: "Grupo ainda não está sincronizado. Tente novamente em instantes." },
        { status: 409 },
      );
    }

    const instance = await getInstanceById(group.instanceId);
    if (!instance) {
      return NextResponse.json(
        { message: "Instância da automação não encontrada para este grupo." },
        { status: 404 },
      );
    }

    const instanceDigits = sanitizeDigits(instance.phone ?? "");

    const filteredDigits = digitsList.filter((digits) => digits !== instanceDigits);

    if (filteredDigits.length === 0) {
      return NextResponse.json({ removed: [], failed: digitsList, message: "Nenhum número válido para remoção." });
    }

    const client = {
      baseUrl: instance.serverBaseUrl,
      token: instance.token,
    };

    const removed: string[] = [];
    const failed: string[] = [];

    for (const digits of filteredDigits) {
      let success = false;
      for (const candidate of candidateParticipants(digits)) {
        try {
          await removeGroupParticipant(client, {
            groupJid: group.remoteId,
            participant: candidate,
          });
          success = true;
          break;
        } catch (error) {
          // tenta com próximo candidato
          console.warn("[blacklist-enforce] falha ao remover participante", {
            groupId: group.remoteId,
            participant: candidate,
            error,
          });
        }
      }
      if (success) {
        removed.push(digits);
      } else {
        failed.push(digits);
      }
    }

    return NextResponse.json({ removed, failed });
  } catch (error) {
    console.error("Failed to enforce group blacklist", error);
    return NextResponse.json(
      { message: "Não foi possível remover os participantes agora." },
      { status: 500 },
    );
  }
}
