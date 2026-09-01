import Image from "next/image";

type BotAdminLogoProps = {
  size?: number;
  className?: string;
  title?: string;
  /** Optional custom logo URL; defaults to the official BotAdmin mark. */
  src?: string | null;
  priority?: boolean;
};

/** Logo oficial BotAdmin (escudo) — nunca monograma BA. */
export const BOTADMIN_LOGO_SRC = "/logo.webp";
export const BOTADMIN_LOGO_FALLBACK = "/images/brand/botadmin-logo.png";

const BotAdminLogo = ({
  size = 40,
  className = "",
  title = "BotAdmin",
  src,
  priority,
}: BotAdminLogoProps) => {
  const logoSrc = (src && src.trim()) || BOTADMIN_LOGO_SRC;

  return (
    <Image
      src={logoSrc}
      alt={title}
      width={size}
      height={size}
      sizes={`(max-width: 480px) ${Math.min(size, 36)}px, ${size}px`}
      className={className || "public-brand__img"}
      style={{
        objectFit: "contain",
        width: size,
        height: size,
        maxWidth: "100%",
      }}
      priority={priority ?? size >= 36}
    />
  );
};

export default BotAdminLogo;
