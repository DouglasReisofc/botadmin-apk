//import custom components
import Header from "layouts/header/Header";
import Sidebar from "layouts/Sidebar";

//import auth helpers
import { getCurrentUser } from "lib/auth";
import { getAdminSiteSettings } from "lib/admin-site";
import { redirect } from "next/navigation";
import PushBootstrap from "components/push/PushBootstrap";
import { getUserPlanStatus } from "lib/plans";
import { getUserBalanceById } from "lib/users";
import CredentialsCompletionPrompt from "components/users/CredentialsCompletionPrompt";
import { PageTitleProvider } from "components/common/page-title-context";
import ClientWrapper from "components/common/ClientWrapper";
import "styles/theme.scss";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";
import "swiper/css/scrollbar";
import "@xyflow/react/dist/style.css";

export const dynamic = "force-dynamic";

interface DashboardProps {
  children: React.ReactNode;
}

const DashboardLayout = async ({ children }: DashboardProps) => {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/sign-in");
  }

  if (user.role === "user") {
    return (
      <ClientWrapper>
        <div className="min-vh-100">
          <PushBootstrap />
          <PageTitleProvider>
            <CredentialsCompletionPrompt
              needsCompletion={user.needsCredentialsCompletion}
              initialEmail={user.email}
            />
            {children}
          </PageTitleProvider>
        </div>
      </ClientWrapper>
    );
  }

  const [siteSettings, planStatus, balance] = await Promise.all([
    getAdminSiteSettings(),
    getUserPlanStatus(user.id),
    getUserBalanceById(user.id),
  ]);
  const currentYear = new Date().getFullYear();

  return (
    <ClientWrapper>
      <div>
        <PushBootstrap />
        <Sidebar
          hideLogo={false}
          containerId="miniSidebar"
          role={user.role}
          siteSettings={{
            logoUrl: siteSettings.logoUrl,
            siteName: siteSettings.siteName,
          }}
        />
        <div id="content" className="position-relative min-vh-100 d-flex flex-column">
          <PageTitleProvider>
            <Header
              user={user}
              siteSettings={{ siteName: siteSettings.siteName, logoUrl: siteSettings.logoUrl }}
              planSnapshot={{ status: planStatus, balance }}
            />
            <div className="custom-container py-4 flex-grow-1">{children}</div>
            <footer className="custom-container mt-auto py-3 text-secondary text-center">
              {siteSettings.siteName} © {currentYear}. Todos os direitos reservados.
            </footer>
          </PageTitleProvider>
        </div>
      </div>
    </ClientWrapper>
  );
};

export default DashboardLayout;
