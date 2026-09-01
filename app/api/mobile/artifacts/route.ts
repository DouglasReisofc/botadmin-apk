import { promises as fs } from "fs";
import path from "path";

import { NextResponse } from "next/server";

import type { MobileArtifactsPayload } from "../../../../types/mobile-artifacts";

const manifestPath = path.join(process.cwd(), "data/mobile-artifacts.json");

async function readManifest(): Promise<MobileArtifactsPayload> {
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    return JSON.parse(raw) as MobileArtifactsPayload;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

export async function GET() {
  try {
    const manifest = await readManifest();
    return NextResponse.json(manifest);
  } catch (error) {
    console.error("Erro ao ler o manifesto de builds móveis:", error);
    return NextResponse.json(
      { message: "Não foi possível carregar os artefatos móveis." },
      { status: 500 }
    );
  }
}
