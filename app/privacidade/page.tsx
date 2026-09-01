import { Container } from "react-bootstrap";
import type { Metadata } from "next";
import Link from "next/link";

import { getPublicAppBaseUrl } from "lib/meta";
import PublicPageShell from "components/site/PublicPageShell";

const PAGE_TITLE = "Política de Privacidade | Bot Admin";
const PAGE_DESCRIPTION =
  "Saiba como o Bot Admin coleta, utiliza, armazena e protege dados pessoais ao usar a plataforma, o painel e o login com provedores como Google.";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const baseUrl = getPublicAppBaseUrl();
  const canonical = new URL("/privacidade", baseUrl).toString();

  return {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    alternates: { canonical },
    openGraph: {
      title: PAGE_TITLE,
      description: PAGE_DESCRIPTION,
      url: canonical,
      siteName: "Bot Admin",
      type: "article",
    },
    twitter: {
      card: "summary",
      title: PAGE_TITLE,
      description: PAGE_DESCRIPTION,
    },
  };
}

const PrivacyPage = () => {
  return (
    <PublicPageShell
      logoUrl={null}
      siteName={"Bot Admin"}
      activePath="/privacidade"
    >
      <Container>
        <div className="mx-auto" style={{ maxWidth: "860px" }}>
          <header className="mb-5 text-center">
            <span className="badge bg-primary-subtle text-primary text-uppercase mb-3">
              Política de privacidade
            </span>
            <h1 className="fw-bold mb-3">Como tratamos seus dados no Bot Admin</h1>
            <p className="text-secondary mb-0">
              Esta política explica quais dados podem ser coletados, por qual motivo eles são
              usados e como protegemos as informações dos usuários da plataforma.
            </p>
          </header>

          <article className="landing-card p-4 p-lg-5" style={{ lineHeight: 1.7 }}>
            <section className="mb-4">
              <h2 className="h4 mb-3">1. Informações que coletamos</h2>
              <p className="text-secondary mb-3">
                Podemos coletar dados informados diretamente por você durante o cadastro, uso do
                painel, contratação de planos e contato com o suporte.
              </p>
              <ul className="text-secondary mb-0">
                <li>Nome, e-mail, telefone ou WhatsApp informado no cadastro.</li>
                <li>Dados de autenticação e histórico básico de acesso à conta.</li>
                <li>Informações de pagamento e assinatura processadas por parceiros autorizados.</li>
                <li>Dados operacionais necessários para configurar bots, grupos, campanhas e integrações.</li>
                <li>Mensagens enviadas ao suporte, logs técnicos e registros de uso da plataforma.</li>
              </ul>
            </section>

            <section className="mb-4">
              <h2 className="h4 mb-3">2. Como usamos seus dados</h2>
              <ul className="text-secondary mb-0">
                <li>Criar, autenticar e manter sua conta ativa na plataforma.</li>
                <li>Permitir o uso dos recursos de automação, moderação e gestão oferecidos pelo Bot Admin.</li>
                <li>Processar pagamentos, liberar planos, emitir confirmações e prevenir fraudes.</li>
                <li>Responder solicitações de suporte, dúvidas e avisos importantes sobre o serviço.</li>
                <li>Melhorar desempenho, segurança, estabilidade e experiência de uso do sistema.</li>
                <li>Cumprir obrigações legais, regulatórias e requisições válidas de autoridades.</li>
              </ul>
            </section>

            <section className="mb-4">
              <h2 className="h4 mb-3">3. Login com Google e outros provedores</h2>
              <p className="text-secondary mb-3">
                Caso o login com Google ou outro provedor de autenticação esteja disponível, os
                dados recebidos serão usados exclusivamente para identificar sua conta, facilitar o
                acesso ao sistema e reforçar a segurança da autenticação.
              </p>
              <ul className="text-secondary mb-0">
                <li>Podemos receber nome, endereço de e-mail e identificador básico da conta autorizada.</li>
                <li>Não solicitamos acesso desnecessário a dados privados fora do escopo de autenticação.</li>
                <li>As informações não são vendidas nem compartilhadas para fins publicitários de terceiros.</li>
              </ul>
            </section>

            <section className="mb-4">
              <h2 className="h4 mb-3">4. Compartilhamento de informações</h2>
              <p className="text-secondary mb-3">
                Seus dados podem ser compartilhados apenas quando isso for necessário para operar o
                serviço de forma legítima e segura.
              </p>
              <ul className="text-secondary mb-0">
                <li>Com provedores de hospedagem, autenticação, pagamento, envio de e-mail e infraestrutura.</li>
                <li>Com parceiros técnicos envolvidos na execução de recursos contratados por você.</li>
                <li>Quando exigido por lei, ordem judicial ou obrigação regulatória aplicável.</li>
              </ul>
            </section>

            <section className="mb-4">
              <h2 className="h4 mb-3">5. Retenção e segurança</h2>
              <ul className="text-secondary mb-0">
                <li>Adotamos medidas técnicas e administrativas razoáveis para proteger os dados armazenados.</li>
                <li>Os dados são mantidos pelo tempo necessário para prestar o serviço e cumprir obrigações legais.</li>
                <li>Mesmo com práticas de segurança, nenhum ambiente online é totalmente livre de riscos.</li>
              </ul>
            </section>

            <section className="mb-4">
              <h2 className="h4 mb-3">6. Seus direitos</h2>
              <p className="text-secondary mb-3">
                Você pode solicitar, conforme a legislação aplicável, acesso, correção, atualização
                ou exclusão de dados pessoais vinculados à sua conta, respeitadas as hipóteses de
                retenção obrigatória.
              </p>
              <p className="text-secondary mb-0">
                Para exercer esses direitos, utilize os canais oficiais de atendimento informados no
                site ou dentro do painel.
              </p>
            </section>

            <section className="mb-4">
              <h2 className="h4 mb-3">7. Cookies e registros técnicos</h2>
              <p className="text-secondary mb-0">
                Podemos utilizar cookies, sessões e registros técnicos para manter seu login ativo,
                proteger a conta, entender falhas operacionais e melhorar a navegação no site e no painel.
              </p>
            </section>

            <section>
              <h2 className="h4 mb-3">8. Atualizações desta política</h2>
              <p className="text-secondary mb-0">
                Esta política pode ser atualizada a qualquer momento para refletir mudanças legais,
                técnicas ou operacionais. O uso continuado da plataforma após a publicação de uma
                nova versão será interpretado como ciência da política atualizada.
              </p>
            </section>
          </article>
          <p className="text-secondary small mt-4 mb-0 text-center">
            Consulte também nossos{" "}
            <Link href="/termos" className="text-decoration-none">
              Termos de uso
            </Link>
            .
          </p>
        </div>
      </Container>
    </PublicPageShell>
  );
};

export default PrivacyPage;
