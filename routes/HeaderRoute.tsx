//import node modules libraries
import type { ReactNode } from "react";
import { v4 as uuid } from "uuid";
import { IconHome, IconLayoutDashboard } from "@tabler/icons-react";

type UserMenuRole = "admin" | "user";

export interface UserMenuLink {
  id: string;
  link: string;
  title: string;
  icon: ReactNode;
  roles: UserMenuRole[];
}

export const UserMenuItem: UserMenuLink[] = [
  {
    id: uuid(),
    link: "/dashboard/admin",
    title: "Painel administrativo",
    icon: <IconLayoutDashboard size={20} strokeWidth={1.5} />,
    roles: ["admin"],
  },
  {
    id: uuid(),
    link: "/dashboard/user",
    title: "Painel do usuário",
    icon: <IconHome size={20} strokeWidth={1.5} />,
    roles: ["admin", "user"],
  },
];
