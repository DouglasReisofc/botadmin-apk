import { formatDate } from "lib/format";
import adminStyles from "components/admin/AdminBotWorkspace.module.css";
import type { BotServer } from "types/bot-instances";
import type { AdminUserSummary } from "types/users";

type AdminDashboardOverviewProps = {
  servers: BotServer[];
  users: AdminUserSummary[];
};

const AdminDashboardOverview = ({ servers, users }: AdminDashboardOverviewProps) => {
  return (
    <div className={adminStyles.dashboard}>
      <section className={adminStyles.dashboardPanel}>
        <header className={adminStyles.dashboardPanelHeader}>
          <strong>Servidores cadastrados</strong>
          <span>Infraestrutura ativa</span>
        </header>
        <div className={adminStyles.dashboardPanelBody}>
          {servers.length === 0 ? (
            <p className={adminStyles.dashboardEmpty}>
              Nenhum servidor configurado. Cadastre um host para liberar novas instâncias.
            </p>
          ) : (
            <ul className={adminStyles.dashboardEntityList}>
              {servers.map((server) => (
                <li key={server.id} className={adminStyles.dashboardEntityItem}>
                  <div className={adminStyles.dashboardEntityMain}>
                    <strong>{server.name}</strong>
                    <span>{server.baseUrl}</span>
                    <small>
                      {formatDate(server.createdAt)} · Limite{" "}
                      {server.sessionLimit === 0 ? "ilimitado" : `${server.sessionLimit} inst.`}
                    </small>
                  </div>
                  <span
                    className={
                      server.isActive
                        ? adminStyles.dashboardPillActive
                        : adminStyles.dashboardPillInactive
                    }
                  >
                    {server.isActive ? "Ativo" : "Inativo"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className={adminStyles.dashboardPanel}>
        <header className={adminStyles.dashboardPanelHeader}>
          <strong>Novos usuários</strong>
          <span>Últimas contas criadas</span>
        </header>
        <div className={adminStyles.dashboardPanelBody}>
          {users.length === 0 ? (
            <p className={adminStyles.dashboardEmpty}>Nenhum usuário cadastrado até o momento.</p>
          ) : (
            <ul className={adminStyles.dashboardUserList}>
              {users.slice(0, 6).map((item) => (
                <li key={item.id} className={adminStyles.dashboardUserItem}>
                  <span className={adminStyles.dashboardUserAvatar}>
                    {(item.name?.trim()?.[0] ?? "U").toUpperCase()}
                  </span>
                  <div className={adminStyles.dashboardUserMain}>
                    <strong>{item.name}</strong>
                    <span>{item.email ?? "Sem e-mail"}</span>
                    <small>
                      {item.isActive ? "Conta ativa" : "Conta inativa"} ·{" "}
                      {item.lastSessionAt
                        ? `Último acesso ${formatDate(item.lastSessionAt)}`
                        : `Criado em ${formatDate(item.createdAt)}`}
                    </small>
                  </div>
                  <span
                    className={
                      item.isActive
                        ? adminStyles.dashboardPillActive
                        : adminStyles.dashboardPillInactive
                    }
                  >
                    {item.isActive ? "Ativo" : "Inativo"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
};

export default AdminDashboardOverview;