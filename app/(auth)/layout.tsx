import Link from "next/link";
import Image from "next/image";

import ThemeToggle from "components/theme/ThemeToggle";
import { BOTADMIN_LOGO_SRC } from "components/brand/BotAdminLogo";
import { getAdminSiteSettings } from "lib/admin-site";

import styles from "./auth.module.css";

export const dynamic = "force-dynamic";

const AuthLayout = async ({ children }: { children: React.ReactNode }) => {
  let siteName = "BotAdmin";
  let logoUrl: string | null = null;
  try {
    const settings = await getAdminSiteSettings();
    siteName = settings.siteName?.trim() || "BotAdmin";
    logoUrl = settings.logoUrl;
  } catch {
    // keep defaults
  }

  const year = new Date().getFullYear();
  const logo = logoUrl?.trim() || BOTADMIN_LOGO_SRC;
  const isBotAdmin =
    siteName.replace(/\s+/g, "").toLowerCase() === "botadmin";

  return (
    <main className={styles.shell}>
      <aside className={styles.brandPanel} aria-hidden="false">
        <div className={styles.brandTop}>
          <Link href="/" className={styles.brandLink}>
            <Image
              src={logo}
              alt={siteName}
              width={44}
              height={44}
              className={styles.brandLogo}
              priority
              unoptimized
            />
            {isBotAdmin ? (
              <span>
                Bot <span className={styles.brandAccent}>Admin</span>
              </span>
            ) : (
              <span>{siteName}</span>
            )}
          </Link>
        </div>

        <div className={styles.brandCopy}>
          <span className={styles.brandEyebrow}>Painel WhatsApp</span>
          <h2 className={styles.brandTitle}>
            Administre grupos com proteção automática
          </h2>
          <p className={styles.brandText}>
            Antilink, moderação, comandos e automações em um painel moderno —
            no celular e no computador.
          </p>
          <ul className={styles.brandPoints}>
            <li>Moderação 24/7 com antilink e remoção automática</li>
            <li>Comandos e boas-vindas prontos para o seu grupo</li>
            <li>Acesso seguro ao painel de conversas</li>
          </ul>
        </div>

        <div className={styles.brandFooter}>
          {siteName} © {year}
        </div>
      </aside>

      <section className={styles.formPanel}>
        <div className={styles.formTop}>
          <Link href="/" className={styles.mobileBrand}>
            <Image
              src={logo}
              alt={siteName}
              width={36}
              height={36}
              priority
              unoptimized
            />
            <span>
              {isBotAdmin ? (
                <>
                  Bot <span className={styles.brandAccent}>Admin</span>
                </>
              ) : (
                siteName
              )}
            </span>
          </Link>
          <div className="ms-auto">
            <ThemeToggle compact />
          </div>
        </div>

        <div className={styles.formScroll}>
          <div className={styles.formInner}>{children}</div>
        </div>

        <footer className={styles.pageFooter}>
          <div>
            {siteName} © {year}
          </div>
          <div className={styles.footerLinks}>
            <Link href="/termos">Termos de uso</Link>
            <Link href="/privacidade">Privacidade</Link>
            <Link href="/">Início</Link>
          </div>
        </footer>
      </section>
    </main>
  );
};

export default AuthLayout;
