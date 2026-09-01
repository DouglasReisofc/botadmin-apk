type SisregLogPayload = {
  context: "watcher" | "manual-pv" | "manual-grupo";
  watcherId?: number | null;
  instanceId: number;
  contactDigits?: string | null;
  code: string;
  unitHint?: string | null;
  unitResolved: string;
  status: string | null;
  intervalLabel?: string | null;
  checkedAt?: Date;
};

const renderBox = (title: string, lines: string[]): string => {
  const sanitized = lines.length ? lines : [""];
  const width = Math.max(title.length, ...sanitized.map((line) => line.length));
  const top = `┌${"─".repeat(width + 2)}┐`;
  const header = `│ ${title.padEnd(width)} │`;
  const divider = `├${"─".repeat(width + 2)}┤`;
  const body = sanitized.map((line) => `│ ${line.padEnd(width)} │`);
  const bottom = `└${"─".repeat(width + 2)}┘`;
  return [top, header, divider, ...body, bottom].join("\n");
};

export const logSisregResult = (payload: SisregLogPayload): void => {
  const {
    context,
    watcherId,
    instanceId,
    contactDigits,
    code,
    unitHint,
    unitResolved,
    status,
    intervalLabel,
    checkedAt = new Date(),
  } = payload;

  const title =
    context === "watcher"
      ? "SISREG MONITORAMENTO"
      : context === "manual-grupo"
        ? "SISREG CONSULTA (GRUPO)"
        : "SISREG CONSULTA (PV)";

  const watcherLabel =
    context === "watcher" && typeof watcherId === "number" && watcherId > 0
      ? String(watcherId)
      : "manual";

  const lines = [
    `Horário: ${checkedAt.toISOString()}`,
    `Instância: ${instanceId}`,
    `Watcher: ${watcherLabel}`,
    `Contato monitorado: ${contactDigits || "-"}`,
    `Código SisReg: ${code}`,
    `Unidade solicitada: ${unitHint || "-"}`,
    `Unidade retornada: ${unitResolved}`,
    `Situação atual: ${status ?? "-"}`,
  ];

  if (intervalLabel) {
    lines.push(`Intervalo configurado: ${intervalLabel}`);
  }

  console.log("");
  console.log(renderBox(title, lines));
  console.log("");
};
