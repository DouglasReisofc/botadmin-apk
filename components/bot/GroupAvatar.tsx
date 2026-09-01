'use client';

import { IconUsers } from "@tabler/icons-react";

type Props = {
  imageUrl?: string | null;
  size?: number;
};

const GroupAvatar = ({ imageUrl, size = 48 }: Props) => {
  const normalized = typeof imageUrl === "string" && imageUrl.trim() ? imageUrl.trim() : null;
  return (
    <div
      className="rounded-circle border bg-light d-flex align-items-center justify-content-center flex-shrink-0"
      style={{
        width: size,
        height: size,
        overflow: "hidden",
        backgroundImage: normalized ? `url(${normalized})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {!normalized && <IconUsers size={Math.max(16, Math.round(size * 0.5))} className="text-muted" />}
    </div>
  );
};

export default GroupAvatar;
