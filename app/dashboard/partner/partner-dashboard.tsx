"use client";

import { FormEvent, useState } from "react";

type PartnerDashboardProps = {
  user: { id: number; name: string; email: string | null };
  brand: { siteName: string; logoUrl: string | null };
  role: string;
  permissions: Record<string, boolean>;
  initial: {
    wallet: { availableCredits: number; creditBalance: number; commissionBalance: number };
    customers: Array<{ userId: number; name: string; email: string; planName?: string | null; planId?: number | null; status: string }>;
    partners: Array<{ userId: number; name: string; email: string; role: string; status: string; creditBalance: number; commissionRate: number }>;
    plans: Array<{ id: number; name: string; durationDays: number; price: number }>;
    financialSettings?: { creditUnitPrice?: number; manualPaymentsEnabled?: boolean; allowChildManualPayments?: boolean; manualPixKey?: string | null; manualInstructions?: string | null };
    planCosts?: Array<{ planId: number; creditCost: number }>;
  };
};

const roleLabel: Record<string, string> = {
  manager: "Master",
  master: "Master",
  reseller: "Revendedor",
  support: "Suporte",
};

export default function PartnerDashboard({ user, brand, role, permissions, initial }: PartnerDashboardProps) {
  const [data, setData] = useState(initial);
  const [showCustomer, setShowCustomer] = useState(false);
  const [showPartner, setShowPartner] = useState(false);
  const [showFinance, setShowFinance] = useState(false);
  const [finance, setFinance] = useState(initial.financialSettings ?? {});
  const [financeBusy, setFinanceBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const logout = async () => {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/sign-in");
    }
  };

  const refresh = async () => {
    const response = await fetch("/api/user/reseller", { cache: "no-store" });
    if (!response.ok) throw new Error("Não foi possível atualizar os dados.");
    const next = await response.json();
    setData({ wallet: next.wallet, customers: next.customers, partners: next.partners ?? [], plans: next.plans, financialSettings: next.financialSettings, planCosts: next.planCosts });
    setFinance(next.financialSettings ?? {});
  };

  const openFinance = async () => {
    setFinanceBusy(true);
    try {
      const response = await fetch('/api/user/reseller/finance', { cache: 'no-store' });
      if (!response.ok) throw new Error('Não foi possível carregar as regras financeiras.');
      const result = await response.json();
      setFinance(result.settings ?? {});
      setData((current) => ({ ...current, planCosts: result.planCosts ?? current.planCosts }));
      setShowFinance(true);
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Não foi possível carregar as regras.'); }
    finally { setFinanceBusy(false); }
  };

  const saveFinance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setFinanceBusy(true); setFeedback(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/user/reseller/finance', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creditUnitPrice: Number(form.get('creditUnitPrice')), manualPaymentsEnabled: form.get('manualPaymentsEnabled') === 'on', allowChildManualPayments: form.get('allowChildManualPayments') === 'on', manualPixKey: form.get('manualPixKey'), manualInstructions: form.get('manualInstructions'), planCosts: data.plans.map((plan) => ({ planId: plan.id, creditCost: Number(form.get(`plan-${plan.id}`) || 1) })) }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message || 'Não foi possível salvar.');
      setFinance(result.settings ?? {}); setData((current) => ({ ...current, planCosts: result.planCosts ?? current.planCosts })); setShowFinance(false); setFeedback('Regras financeiras atualizadas.');
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Não foi possível salvar.'); }
    finally { setFinanceBusy(false); }
  };

  const submitPartner = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/user/reseller", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_subpartner",
          name: form.get("name"),
          email: form.get("email"),
          whatsappNumber: form.get("whatsappNumber"),
          password: form.get("password"),
          role: "reseller",
          initialCredits: Number(form.get("initialCredits") || 0),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Não foi possível criar o revendedor.");
      await refresh();
      setShowPartner(false);
      setFeedback("Revendedor criado com sucesso.");
      event.currentTarget.reset();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  };

  const submitCustomer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/user/reseller", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_customer",
          name: form.get("name"),
          email: form.get("email"),
          whatsappNumber: form.get("whatsappNumber"),
          password: form.get("password"),
          planId: form.get("planId") || null,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Não foi possível criar o cliente.");
      await refresh();
      setShowCustomer(false);
      setFeedback(result.planId ? "Cliente criado e ativado." : "Cliente criado com sucesso.");
      event.currentTarget.reset();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  };

  const activate = async (customerUserId: number, planId: number) => {
    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/user/reseller", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate", customerUserId, planId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Não foi possível ativar.");
      setData((current) => ({ ...current, wallet: result.wallet ?? current.wallet }));
      await refresh();
      setFeedback("Plano ativado com sucesso.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="partner-shell">
      <style jsx>{`
        .partner-shell { min-height: 100vh; background: #f4f7f8; color: #172026; padding: 28px 18px 48px; }
        .partner-wrap { max-width: 1120px; margin: 0 auto; }
        .brand { display:flex; align-items:center; gap:12px; margin-bottom:20px; color:#172026; font-weight:750; font-size:18px; }
        .brand img { width:38px; height:38px; object-fit:contain; border-radius:10px; }
        .brand-mark { width:38px; height:38px; border-radius:10px; background:#008f73; color:white; display:grid; place-items:center; }
        .partner-header { display:flex; justify-content:space-between; gap:18px; align-items:center; margin-bottom:24px; }
        .partner-header h1 { margin:0; font-size:28px; } .partner-header p { margin:5px 0 0; color:#64737b; }
        .partner-actions { display:flex; gap:10px; flex-wrap:wrap; } button { border:0; border-radius:10px; padding:11px 16px; font-weight:600; cursor:pointer; } button:disabled { opacity:.55; cursor:wait; }
        .primary { color:white; background:#008f73; } .secondary { background:white; border:1px solid #d5dfe2; color:#33454c; }
        .metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px; margin-bottom:18px; } .card { background:white; border:1px solid #dce5e7; border-radius:16px; padding:18px; box-shadow:0 5px 18px #1720260d; }
        .metric-label { color:#6b7b82; font-size:13px; } .metric-value { font-size:25px; font-weight:750; margin-top:7px; }
        .section-title { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:13px; } h2 { font-size:19px; margin:0; } .muted { color:#6b7b82; }
        .customer { display:flex; justify-content:space-between; gap:12px; align-items:center; border-top:1px solid #edf1f2; padding:14px 0; } .customer:first-of-type { border-top:0; }
        .customer-name { font-weight:650; } .customer-meta { color:#6b7b82; font-size:13px; margin-top:3px; } .customer button { padding:8px 12px; }
        .feedback { margin:14px 0; padding:11px 13px; border-radius:10px; background:#e6f7f1; color:#176b57; } .empty { padding:30px 10px; text-align:center; color:#6b7b82; }
        .modal-backdrop { position:fixed; inset:0; background:#10202780; display:grid; place-items:center; padding:18px; z-index:20; } .modal { background:white; width:min(480px,100%); border-radius:18px; padding:22px; } .modal h2 { margin-bottom:16px; }
        label { display:block; font-size:13px; font-weight:600; margin:12px 0 6px; } input, select { width:100%; box-sizing:border-box; padding:11px 12px; border:1px solid #cbd7da; border-radius:9px; font:inherit; } .modal-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:18px; }
        @media (max-width:700px) { .partner-header { align-items:flex-start; flex-direction:column; } .metrics { grid-template-columns:1fr; } .customer { align-items:flex-start; flex-direction:column; } }
      `}</style>
      <div className="partner-wrap">
        <div className="brand">
          {brand.logoUrl ? <img src={brand.logoUrl} alt="" /> : <span className="brand-mark">B</span>}
          <span>{brand.siteName}</span>
        </div>
        <header className="partner-header">
          <div><h1>Programa de parceiros</h1><p>{user.name} · {roleLabel[role] || "Parceiro"} · {user.email}</p></div>
          <div className="partner-actions"><button className="secondary" onClick={() => refresh().catch((error) => setFeedback(error.message))}>Atualizar</button>{permissions.view_financial && <button className="secondary" disabled={financeBusy} onClick={openFinance}>Regras financeiras</button>}{permissions.manage_partners && <button className="primary" onClick={() => setShowPartner(true)}>Novo revendedor</button>}{permissions.manage_customers && <button className="primary" onClick={() => setShowCustomer(true)}>Novo cliente</button>}<button className="secondary" disabled={busy} onClick={logout}>Sair</button></div>
        </header>
        {feedback && <div className="feedback">{feedback}</div>}
        <section className="metrics">
          {permissions.view_financial && <div className="card"><div className="metric-label">Créditos disponíveis</div><div className="metric-value">{data.wallet.availableCredits}</div></div>}
          {permissions.manage_customers && <div className="card"><div className="metric-label">Clientes gerenciados</div><div className="metric-value">{data.customers.length}</div></div>}
          {permissions.view_financial && <div className="card"><div className="metric-label">Comissões acumuladas</div><div className="metric-value">R$ {Number(data.wallet.commissionBalance || 0).toFixed(2)}</div></div>}
        </section>
        {permissions.view_financial && <section className="card"><div className="section-title"><h2>Minha carteira</h2><span className="muted">Saldo total: {data.wallet.creditBalance}</span></div><p className="muted">Cada ativação ou renovação consome um crédito. O admin pode lançar novos créditos no painel de parceiros.</p></section>}
        {permissions.manage_customers && <section className="card" style={{ marginTop: 18 }}><div className="section-title"><h2>Clientes</h2><span className="muted">{data.customers.length} cadastrados</span></div>{data.customers.length === 0 ? <div className="empty">Nenhum cliente cadastrado.</div> : data.customers.map((customer) => <div className="customer" key={customer.userId}><div><div className="customer-name">{customer.name}</div><div className="customer-meta">{customer.email}{customer.planName ? ` · ${customer.planName}` : " · Sem plano ativo"}</div></div>{permissions.activate_customers && data.plans.length > 0 && <button className="secondary" disabled={busy} onClick={() => activate(customer.userId, customer.planId || data.plans[0].id)}>{customer.planId ? "Renovar" : "Ativar"}</button>}</div>)}</section>}
        {permissions.manage_partners && <section className="card" style={{ marginTop: 18 }}><div className="section-title"><h2>Minha equipe</h2><span className="muted">{data.partners.length} parceiros</span></div>{data.partners.length === 0 ? <div className="empty">Nenhum revendedor na sua equipe.</div> : data.partners.map((partner) => <div className="customer" key={partner.userId}><div><div className="customer-name">{partner.name}</div><div className="customer-meta">{partner.email} · {partner.creditBalance} créditos · {partner.commissionRate}% comissão</div></div><span className="muted">{partner.status === "active" ? "Ativo" : "Suspenso"}</span></div>)}</section>}
      </div>
      {showCustomer && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCustomer(false); }}><form className="modal" onSubmit={submitCustomer}><h2>Novo cliente</h2><label htmlFor="partner-name">Nome</label><input id="partner-name" name="name" required /><label htmlFor="partner-email">E-mail</label><input id="partner-email" name="email" type="email" required /><label htmlFor="partner-whatsapp">WhatsApp (opcional)</label><input id="partner-whatsapp" name="whatsappNumber" /><label htmlFor="partner-password">Senha inicial</label><input id="partner-password" name="password" type="password" minLength={6} required /><label htmlFor="partner-plan">Plano inicial (opcional)</label><select id="partner-plan" name="planId"><option value="">Criar sem ativar</option>{data.plans.map((plan) => <option value={plan.id} key={plan.id}>{plan.name} · {plan.durationDays} dias</option>)}</select><div className="modal-actions"><button type="button" className="secondary" onClick={() => setShowCustomer(false)}>Cancelar</button><button className="primary" disabled={busy}>{busy ? "Salvando..." : "Criar cliente"}</button></div></form></div>}
        {showPartner && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowPartner(false); }}><form className="modal" onSubmit={submitPartner}><h2>Novo revendedor</h2><p className="muted">O crédito inicial será transferido da sua carteira.</p><label htmlFor="subpartner-name">Nome</label><input id="subpartner-name" name="name" required /><label htmlFor="subpartner-email">E-mail</label><input id="subpartner-email" name="email" type="email" required /><label htmlFor="subpartner-whatsapp">WhatsApp (opcional)</label><input id="subpartner-whatsapp" name="whatsappNumber" /><label htmlFor="subpartner-password">Senha inicial</label><input id="subpartner-password" name="password" type="password" minLength={6} required /><label htmlFor="subpartner-credits">Créditos iniciais</label><input id="subpartner-credits" name="initialCredits" type="number" min="0" max="100000" defaultValue="0" required /><div className="modal-actions"><button type="button" className="secondary" onClick={() => setShowPartner(false)}>Cancelar</button><button className="primary" disabled={busy}>{busy ? "Salvando..." : "Criar revendedor"}</button></div></form></div>}
      {showFinance && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowFinance(false); }}><form className="modal" onSubmit={saveFinance}><h2>Regras financeiras</h2><p className="muted">Defina o preço do crédito, o pagamento manual e o custo de cada plano.</p><label htmlFor="creditUnitPrice">Valor de cada crédito (R$)</label><input id="creditUnitPrice" name="creditUnitPrice" type="number" min="0.01" step="0.01" defaultValue={finance.creditUnitPrice ?? 29.9} required /><label><input name="manualPaymentsEnabled" type="checkbox" defaultChecked={finance.manualPaymentsEnabled === true} /> Permitir Pix manual com comprovante</label>{role === 'master' && <label><input name="allowChildManualPayments" type="checkbox" defaultChecked={finance.allowChildManualPayments === true} /> Liberar Pix manual para subordinados</label>}<label htmlFor="manualPixKey">Chave Pix</label><input id="manualPixKey" name="manualPixKey" defaultValue={finance.manualPixKey ?? ''} /><label htmlFor="manualInstructions">Instruções</label><input id="manualInstructions" name="manualInstructions" defaultValue={finance.manualInstructions ?? ''} /><h3>Créditos por plano</h3>{data.plans.map((plan) => <div key={plan.id}><label htmlFor={`plan-${plan.id}`}>{plan.name} ({plan.durationDays} dias)</label><input id={`plan-${plan.id}`} name={`plan-${plan.id}`} type="number" min="1" defaultValue={data.planCosts?.find((cost) => cost.planId === plan.id)?.creditCost ?? (plan.durationDays >= 300 ? 10 : 1)} /></div>)}<div className="modal-actions"><button type="button" className="secondary" onClick={() => setShowFinance(false)}>Cancelar</button><button className="primary" disabled={financeBusy}>{financeBusy ? 'Salvando...' : 'Salvar regras'}</button></div></form></div>}
    </main>
  );
}
