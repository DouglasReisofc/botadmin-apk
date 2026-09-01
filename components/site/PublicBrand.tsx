import Link from "next/link";

import BotAdminLogo, { BOTADMIN_LOGO_SRC } from "components/brand/BotAdminLogo";

type PublicBrandProps = {
  logoUrl?: string | null;
  siteName?: string | null;
  size?: number;
};

const PublicBrand = ({ logoUrl, siteName, size = 40 }: PublicBrandProps) => {
  const brandName = siteName?.trim() || "BotAdmin";
  const normalized = brandName.replace(/\s+/g, "").toLowerCase();
  const isBotAdmin = normalized === "botadmin" || normalized === "bot admin";
  // logoUrl do admin tem prioridade; senão logo oficial do site
  const resolvedLogo = logoUrl?.trim() || BOTADMIN_LOGO_SRC;

  return (
    <Link
      href="/"
      className="public-brand d-inline-flex align-items-center gap-2 fw-bold fs-4 text-decoration-none"
      aria-label={`${brandName} - pagina inicial`}
    >
      <BotAdminLogo
        size={size}
        src={resolvedLogo}
        title={`Logo ${brandName}`}
        className="public-brand__img"
        priority
      />
      {isBotAdmin ? (
        <span className="public-brand__text">
          Bot <span className="public-brand__accent">Admin</span>
        </span>
      ) : (
        <span className="public-brand__text">{brandName}</span>
      )}
    </Link>
  );
};

export default PublicBrand;
