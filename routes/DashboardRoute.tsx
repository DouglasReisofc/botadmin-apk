//import node modules libraries
import {
  IconHome,
  IconLayoutDashboard,
  IconCreditCard,
  IconPlugConnected,
  IconRobot,
  IconHelpCircle,
  IconWorld,
  IconUsers,
  IconSettings,
  IconCalendar,
  IconDeviceMobileDown,
  IconMail,
  IconBrandWhatsapp,
  IconHeadset,
  IconUsersGroup,
  IconTicket,
  IconCloudDownload,
  IconSpeakerphone,
  IconBook,
  IconLink,
  IconApi,
  IconBroadcast,
  IconShoppingCart,
  IconMessages,
  IconBolt,
} from "@tabler/icons-react";

//import custom type
import { MenuItemType } from "types/menuTypes";

const adminMenu: MenuItemType[] = [
  {
    id: "admin-dashboard",
    title: "Painel",
    link: "/dashboard/admin",
    icon: <IconLayoutDashboard size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "admin-firebase",
    title: "Firebase",
    link: "/dashboard/admin/firebase",
    icon: <IconWorld size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "admin-site-settings",
    title: "Config. do site",
    link: "/dashboard/admin/site",
    icon: <IconSettings size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "admin-mobile",
    title: "Aplicativo",
    link: "/dashboard/admin/aplicativo",
    icon: <IconDeviceMobileDown size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "admin-bot",
    title: "Bot administrativo",
    link: "/dashboard/admin/bot",
    icon: <IconRobot size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "admin-campaigns",
    title: "Campanhas",
    link: "/dashboard/admin/campanhas",
    icon: <IconSpeakerphone size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "admin-mega-credentials",
    title: "Mega downloader",
    link: "/dashboard/admin/mega",
    icon: <IconCloudDownload size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "admin-botinterage-config",
    title: "BotInterage Config",
    link: "/dashboard/admin/botinterage",
    icon: <IconRobot size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "admin-support",
    title: "Suporte",
    link: "/dashboard/admin/suporte",
    icon: <IconHeadset size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "admin-instances",
    title: "Instâncias",
    link: "/dashboard/admin/instancias",
    icon: <IconRobot size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "admin-servers",
    title: "Servidores",
    link: "/dashboard/admin/servidores",
    icon: <IconPlugConnected size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "admin-tutorials",
    title: "Tutoriais",
    link: "/dashboard/admin/tutoriais",
    icon: <IconHelpCircle size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "admin-plans",
    title: "Planos",
    link: "/dashboard/admin/planos",
    icon: <IconCalendar size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "admin-payments",
    title: "Pagamentos",
    link: "/dashboard/admin/pagamentos",
    icon: <IconCreditCard size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "admin-affiliates",
    title: "Afiliados",
    link: "/dashboard/admin/afiliados",
    icon: <IconShoppingCart size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "admin-notifications",
    title: "Notificações",
    link: "/dashboard/admin/notificacoes",
    icon: <IconMail size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "admin-useful-links",
    title: "Links úteis",
    link: "/dashboard/admin/linksuteis",
    icon: <IconLink size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "admin-groups",
    title: "Grupos do bot",
    link: "/dashboard/admin/grupos",
    icon: <IconUsersGroup size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "admin-users",
    title: "Usuários",
    link: "/dashboard/admin/users",
    icon: <IconUsers size={20} strokeWidth={1.5} color="currentColor" />,
  },
];


const userMenu: MenuItemType[] = [
  {
    id: "user-dashboard",
    title: "Painel",
    link: "/dashboard/user",
    icon: <IconHome size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "user-bot",
    title: "Conectar WhatsApp",
    link: "/dashboard/user/configurar-bot",
    icon: <IconBrandWhatsapp size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "user-ad-campaigns",
    title: "Campanhas e anúncios",
    link: "/dashboard/user/campanhas",
    icon: <IconSpeakerphone size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "user-affiliates",
    title: "Afiliados",
    link: "/dashboard/user?section=affiliates&botAdminAffiliate=1",
    icon: <IconShoppingCart size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "user-raffles",
    title: "Minhas Rifas",
    link: "/dashboard/user/rifas",
    icon: <IconTicket size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "user-flows",
    title: "Fluxos",
    link: "/dashboard/user?section=flows",
    icon: <IconBolt size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "user-download-app",
    title: "Baixar app",
    link: "/dashboard/user/baixar-app",
    icon: <IconDeviceMobileDown size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "user-tutorials",
    title: "Tutoriais",
    link: "/tutorials",
    icon: <IconBook size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "user-whatsapp-panel",
    title: "Painel WhatsApp",
    link: "/dashboard/user/painel-whatsapp",
    icon: <IconBrandWhatsapp size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "user-whatsapp-conversations",
    title: "Conversas",
    link: "/dashboard/user?section=conversations",
    icon: <IconMessages size={20} strokeWidth={1.5} color="currentColor" />,
  },
  {
    id: "user-api-rest",
    title: "API REST",
    link: "/dashboard/user/apirest",
    icon: <IconApi size={20} strokeWidth={1.5} color="currentColor" />,
  },
];

export const getDashboardMenu = (role: "admin" | "user"): MenuItemType[] => {
  if (role === "admin") {
    return adminMenu;
  }

  return userMenu;
};
