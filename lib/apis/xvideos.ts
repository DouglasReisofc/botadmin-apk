import path from "node:path";

type XvideosAdapter = {
  xvideos?: (req: any, res: any, apikey?: string | null) => void;
};

let cachedModule: XvideosAdapter | null = null;

const loadXvideosAdapter = (): XvideosAdapter | null => {
  if (cachedModule) return cachedModule;
  try {
    const integrationRequire = eval("require") as NodeJS.Require;
    const modulePath = path.join(process.cwd(), "lib", "integrations", "apis", "funcoes", "xvideos.js");
    cachedModule = integrationRequire(modulePath);
    return cachedModule;
  } catch (error) {
    console.error("[xvideos] Falha ao carregar integração:", error);
    cachedModule = null;
    return null;
  }
};

export const callXvideos = (query: { nome: string; op?: string }): Promise<any> => {
  return new Promise((resolve, reject) => {
    const adapter = loadXvideosAdapter();
    if (!adapter?.xvideos) {
      return reject(new Error("Integração Xvideos indisponível"));
    }
    try {
      adapter.xvideos(
        { query },
        {
          send: (payload: any) => resolve(payload),
        },
        null,
      );
    } catch (error) {
      reject(error);
    }
  });
};
