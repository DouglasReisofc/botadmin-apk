import Link from "next/link";
import { Container } from "react-bootstrap";

import PublicBrand from "components/site/PublicBrand";
import ThemeToggle from "components/theme/ThemeToggle";

type PublicPageShellProps = {
  logoUrl?: string | null;
  siteName?: string | null;
  children: React.ReactNode;
  activePath?: string;
};

const NAV = [
  { href: "/comandos", label: "Comandos" },
  { href: "/tutorials", label: "Tutoriais" },
  { href: "/grupos-oficiais", label: "Grupos" },
] as const;

/**
 * Shell público com o mesmo tema dark/clean da landing
 * (header + footer + tokens .landing-page).
 */
const PublicPageShell = ({
  logoUrl,
  siteName,
  children,
  activePath = "",
}: PublicPageShellProps) => {
  const brand = siteName?.trim() || "BotAdmin";

  return (
    <main className="landing-page public-inner-page">
      <header className="landing-header">
        <Container>
          <nav className="d-flex align-items-center justify-content-between flex-wrap gap-3 py-3">
            <PublicBrand logoUrl={logoUrl} siteName={brand} size={38} />
            <div className="d-flex align-items-center flex-wrap gap-2 gap-md-3 small fw-semibold">
              {NAV.map((item) => {
                const active =
                  activePath === item.href ||
                  activePath.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`landing-nav-link ${active ? "is-active" : ""}`}
                  >
                    {item.label}
                  </Link>
                );
              })}
              <ThemeToggle className="theme-toggle" />
              <Link href="/sign-in" className="landing-btn landing-btn--neon">
                Entrar
              </Link>
            </div>
          </nav>
        </Container>
      </header>

      <section className="landing-section public-inner-page__body">
        <Container>
          <div className="mx-auto public-inner-page__content">{children}</div>
        </Container>
      </section>

      <footer className="landing-footer">
        <Container className="d-flex justify-content-between flex-wrap gap-3 small py-4">
          <span className="landing-footer__brand">
            © {new Date().getFullYear()} {brand}. Todos os direitos reservados.
          </span>
          <div className="d-flex gap-3 flex-wrap">
            <Link href="/comandos" className="landing-nav-link">
              Comandos
            </Link>
            <Link href="/tutorials" className="landing-nav-link">
              Tutoriais
            </Link>
            <Link href="/termos" className="landing-nav-link">
              Termos
            </Link>
            <Link href="/privacidade" className="landing-nav-link">
              Privacidade
            </Link>
          </div>
        </Container>
      </footer>
    </main>
  );
};

export default PublicPageShell;
