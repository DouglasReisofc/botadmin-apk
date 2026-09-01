"use client";

import dynamic from "next/dynamic";

import AdminDashboardOverview from "components/admin/AdminDashboardOverview";
import adminStyles from "components/admin/AdminBotWorkspace.module.css";
import type { AdminDetailSection } from "components/admin/admin-workspace-config";
import type { BotServer } from "types/bot-instances";
import type { AdminUserSummary } from "types/users";

const AdminSupportCenter = dynamic(() => import("components/admin/AdminSupportCenter"), { ssr: false });
const AdminUserManager = dynamic(() => import("components/users/AdminUserManager"), { ssr: false });
const AdminInstanceManager = dynamic(() => import("components/admin/AdminInstanceManager"), { ssr: false });
const BotServerManager = dynamic(() => import("components/admin/BotServerManager"), { ssr: false });
const AdminBotInteragePageSections = dynamic(() => import("components/admin/AdminBotInteragePageSections"), { ssr: false });
const AdminMegaCredentialsForm = dynamic(() => import("components/admin/AdminMegaCredentialsForm"), { ssr: false });
const AdminGroupManager = dynamic(() => import("components/admin/AdminGroupManager"), { ssr: false });
const AdminCampaignManager = dynamic(() => import("components/admin/AdminCampaignManager"), { ssr: false });
const AdminPlanManager = dynamic(() => import("components/admin/AdminPlanManager"), { ssr: false });
const UserPaymentsConfig = dynamic(() => import("components/payments/UserPaymentsConfig"), { ssr: false });
const AdminAffiliateProvidersForm = dynamic(() => import("components/admin/AdminAffiliateProvidersForm"), { ssr: false });
const AdminSiteSettingsForm = dynamic(() => import("components/admin/AdminSiteSettingsForm"), { ssr: false });
const AdminFirebaseSettingsForm = dynamic(() => import("components/admin/AdminFirebaseSettingsForm"), { ssr: false });
const AdminMobileSettingsForm = dynamic(() => import("components/admin/AdminMobileSettingsForm"), { ssr: false });
const AdminNotificationsSettings = dynamic(() => import("components/admin/AdminNotificationsSettings"), { ssr: false });
const AdminUsefulLinksManager = dynamic(() => import("components/admin/AdminUsefulLinksManager"), { ssr: false });
const AdminTutorialManager = dynamic(() => import("components/admin/AdminTutorialManager"), { ssr: false });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

export type AdminWorkspaceContentProps = {
  section: AdminDetailSection;
  servers: BotServer[];
  users: AdminUserSummary[];
  usersPage: {
    initialQuery: string;
    initialStatus: "all" | "active" | "inactive";
    initialPlan: "all" | "with_active" | "without_active";
    initialUsers: AdminUserSummary[];
    initialPage: number;
    initialPageSize: number;
    initialTotal: number;
    initialHasMore: boolean;
  };
  instances: AnyRecord[];
  groupsPage: {
    initialQuery: string;
    initialGroups: AnyRecord[];
    initialPage: number;
    initialPageSize: number;
    initialTotal: number;
    initialHasMore: boolean;
  };
  botInterage: {
    iaConfig: AnyRecord;
    iaAllowedUsers: AnyRecord[];
    ttsConfig: AnyRecord;
    ttsAllowedUsers: AnyRecord[];
  };
  megaCredentials: AnyRecord;
  campaigns: AnyRecord[];
  campaignTemplates: AnyRecord[];
  hasTemplateCredentials: boolean;
  plans: AnyRecord[];
  trialSettings: AnyRecord;
  trialVariables: AnyRecord[];
  payments: AnyRecord;
  affiliateProviders: AnyRecord[];
  siteSettings: AnyRecord;
  siteInstances: AnyRecord[];
  siteGroups: AnyRecord[];
  firebaseSettings: AnyRecord;
  mobileSettings: AnyRecord;
  mobileSiteSettings: AnyRecord;
  notifications: AnyRecord;
  usefulLinks: AnyRecord[];
  usefulLinkBanners: AnyRecord[];
  tutorials: AnyRecord[];
  tutorialSections: AnyRecord[];
};

const AdminBotWorkspaceContent = (props: AdminWorkspaceContentProps) => {
  const { section } = props;

  const wrap = (content: import("react").ReactNode, options?: { support?: boolean }) => {
    if (options?.support) {
      return <div className={adminStyles.adminEmbeddedSupport}>{content}</div>;
    }
    return <div className={adminStyles.adminContent}>{content}</div>;
  };

  switch (section) {
    case "dashboard":
      return wrap(
        <AdminDashboardOverview servers={props.servers} users={props.users} />,
      );
    case "support":
      return wrap(<AdminSupportCenter embedded />, { support: true });
    case "users":
      return wrap(
        <AdminUserManager
          initialQuery={props.usersPage.initialQuery}
          initialStatus={props.usersPage.initialStatus}
          initialPlan={props.usersPage.initialPlan}
          initialUsers={props.usersPage.initialUsers}
          initialPage={props.usersPage.initialPage}
          initialPageSize={props.usersPage.initialPageSize}
          initialTotal={props.usersPage.initialTotal}
          initialHasMore={props.usersPage.initialHasMore}
        />,
      );
    case "instances":
      return wrap(<AdminInstanceManager instances={props.instances} servers={props.servers} />);
    case "servers":
      return wrap(<BotServerManager servers={props.servers} />);
    case "botinterage":
      return wrap(
        <AdminBotInteragePageSections
          iaConfig={props.botInterage.iaConfig}
          iaAllowedUsers={props.botInterage.iaAllowedUsers}
          ttsConfig={props.botInterage.ttsConfig}
          ttsAllowedUsers={props.botInterage.ttsAllowedUsers}
        />,
      );
    case "mega":
      return wrap(<AdminMegaCredentialsForm initialCredentials={props.megaCredentials} />);
    case "groups":
      return wrap(
        <AdminGroupManager
          initialQuery={props.groupsPage.initialQuery}
          initialGroups={props.groupsPage.initialGroups}
          initialPage={props.groupsPage.initialPage}
          initialPageSize={props.groupsPage.initialPageSize}
          initialTotal={props.groupsPage.initialTotal}
          initialHasMore={props.groupsPage.initialHasMore}
        />,
      );
    case "campaigns":
      return wrap(
        <AdminCampaignManager
          campaigns={props.campaigns}
          templates={props.campaignTemplates}
          hasTemplateCredentials={props.hasTemplateCredentials}
        />,
      );
    case "plans":
      return wrap(
        <AdminPlanManager
          plans={props.plans}
          trialSettings={props.trialSettings}
          trialVariables={props.trialVariables}
        />,
      );
    case "payments":
      return wrap(
        <UserPaymentsConfig
          pixConfig={props.payments.pixConfig}
          polopagConfig={props.payments.polopagConfig}
          checkoutConfig={props.payments.checkoutConfig}
          confirmationConfig={props.payments.confirmationConfig}
          cardTitle={props.payments.cardTitle}
          cardDescription={props.payments.cardDescription}
          endpoints={props.payments.endpoints}
          viewOptionsOverride={props.payments.viewOptionsOverride}
        />,
      );
    case "affiliates":
      return wrap(<AdminAffiliateProvidersForm initialProviders={props.affiliateProviders} />);
    case "site":
      return wrap(
        <AdminSiteSettingsForm
          initialSettings={props.siteSettings}
          availableInstances={props.siteInstances}
          availableGroups={props.siteGroups}
        />,
      );
    case "firebase":
      return wrap(<AdminFirebaseSettingsForm initialSettings={props.firebaseSettings} />);
    case "aplicativo":
      return wrap(
        <AdminMobileSettingsForm
          initialMobile={props.mobileSettings}
          initialSite={props.mobileSiteSettings}
        />,
      );
    case "notificacoes":
      return wrap(
        <AdminNotificationsSettings
          billingSettings={props.notifications.billingSettings}
          billingVariables={props.notifications.billingVariables}
          smtpSettings={props.notifications.smtpSettings}
          emailTemplates={props.notifications.emailTemplates}
          recipients={props.notifications.recipients}
          planGuardSettings={props.notifications.planGuardSettings}
          planGuardVariables={props.notifications.planGuardVariables}
        />,
      );
    case "linksuteis":
      return wrap(<AdminUsefulLinksManager links={props.usefulLinks} banners={props.usefulLinkBanners} />);
    case "tutoriais":
      return wrap(<AdminTutorialManager tutorials={props.tutorials} sections={props.tutorialSections} />);
    default:
      return null;
  }
};

export default AdminBotWorkspaceContent;