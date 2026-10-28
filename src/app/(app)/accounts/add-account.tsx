"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";
import { Plus, Landmark, Leaf, Building2, PiggyBank, Pencil, X } from "lucide-react";
import { buttonCls, inputCls, selectCls } from "@/components/ui";
import {
  addManualAccount,
  addPensionAccount,
  connectFinancy,
  connectRiseup,
} from "../actions";

type Panel = "menu" | "plaid" | "riseup" | "financy" | "pension" | "manual";

export function AddAccountButton({ primary = false }: { primary?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={buttonCls(primary ? "primary" : "primary", "md")}
        onClick={() => setOpen(true)}
      >
        <Plus size={15} /> Add account
      </button>
      {open ? <AddAccountModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function AddAccountModal({ onClose }: { onClose: () => void }) {
  const [panel, setPanel] = useState<Panel>("menu");
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-[520px] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">
            {panel === "menu" && "Add account"}
            {panel === "plaid" && "Connect a US institution"}
            {panel === "riseup" && "Connect RiseUp (Israel)"}
            {panel === "financy" && "Connect Financy (Israel)"}
            {panel === "pension" && "Israeli pension / study fund"}
            {panel === "manual" && "Manual account"}
          </h2>
          <button onClick={onClose} className="cursor-pointer text-muted hover:text-ink">
            <X size={17} />
          </button>
        </div>
        {panel === "menu" ? <Menu onPick={setPanel} /> : null}
        {panel === "plaid" ? <PlaidPanel onDone={onClose} /> : null}
        {panel === "riseup" ? <RiseupPanel onDone={onClose} /> : null}
        {panel === "financy" ? <FinancyPanel onDone={onClose} /> : null}
        {panel === "pension" ? <PensionPanel onDone={onClose} /> : null}
        {panel === "manual" ? <ManualPanel onDone={onClose} /> : null}
      </div>
    </div>
  );
}

function Menu({ onPick }: { onPick: (p: Panel) => void }) {
  const items: { panel: Panel; icon: React.ReactNode; title: string; sub: string }[] = [
    {
      panel: "plaid",
      icon: <Landmark size={17} />,
      title: "US bank or brokerage",
      sub: "Robinhood, banks, cards — via Plaid",
    },
    {
      panel: "riseup",
      icon: <Leaf size={17} />,
      title: "RiseUp (Israel)",
      sub: "Israeli banks + cards with RiseUp categories, via API token",
    },
    {
      panel: "financy",
      icon: <Building2 size={17} />,
      title: "Financy (Israel)",
      sub: "Israeli banks + cards via open banking, with your Financy API key",
    },
    {
      panel: "pension",
      icon: <PiggyBank size={17} />,
      title: "Pension / keren hishtalmut",
      sub: "Auto-updates monthly from the fund's published yield",
    },
    {
      panel: "manual",
      icon: <Pencil size={17} />,
      title: "Manual account",
      sub: "Anything else — you update the balance",
    },
  ];
  return (
    <div className="flex flex-col gap-2">
      {items.map((i) => (
        <button
          key={i.panel}
          onClick={() => onPick(i.panel)}
          className="flex cursor-pointer items-center gap-3 rounded-lg border border-line p-3 text-left transition-colors hover:border-accent hover:bg-accent-soft/40"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent">
            {i.icon}
          </span>
          <span>
            <span className="block text-[14px] font-medium">{i.title}</span>
            <span className="block text-[12.5px] text-muted">{i.sub}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function PlaidPanel({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Getting a secure link token…");

  useEffect(() => {
    fetch("/api/plaid/link-token", { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (d.link_token) {
          setLinkToken(d.link_token);
          setStatus("");
        } else setStatus(d.error ?? "Could not get a link token.");
      })
      .catch(() => setStatus("Could not get a link token."));
  }, []);

  const onSuccess = useCallback(
    (
      public_token: string | null,
      metadata: { institution?: { name?: string } | null },
    ) => {
      if (!public_token) {
        setStatus("Plaid did not return a token. Try again.");
        return;
      }
      setStatus("Linking and running the first sync…");
      fetch("/api/plaid/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          public_token,
          institution_name: metadata.institution?.name,
        }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.error) setStatus(`Failed: ${d.error}`);
          else {
            router.refresh();
            onDone();
          }
        });
    },
    [router, onDone],
  );

  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-muted">
        Plaid opens a secure window. Pick your bank or brokerage and sign in
        there. Peanut never sees your bank password.
      </p>
      {status ? <p className="text-[13px] text-ink-soft">{status}</p> : null}
      <button
        className={buttonCls("primary")}
        disabled={!ready || !linkToken}
        onClick={() => open()}
      >
        Open Plaid Link
      </button>
    </div>
  );
}

function RiseupPanel({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await connectRiseup(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
      onDone();
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-3">
      <p className="text-[13px] text-muted">
        1. Go to{" "}
        <a
          href="https://input.riseup.co.il/developer/tokens"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-accent"
        >
          input.riseup.co.il/developer/tokens
        </a>{" "}
        and sign in.
        <br />
        2. Create a token with the <b>budget:read</b> scope.
        <br />
        3. Copy it here. It starts with <code>riseup_pat_</code>.
      </p>
      <input
        name="token"
        className={inputCls}
        placeholder="riseup_pat_…"
        autoComplete="off"
      />
      <p className="text-[12px] text-faint">
        RiseUp tokens expire after 30 days. Peanut will warn you when it is
        time to make a new one. The first sync pulls 12 months of
        transactions with RiseUp&apos;s categories.
      </p>
      {error ? <p className="text-[13px] text-neg">{error}</p> : null}
      <button className={buttonCls("primary")} disabled={pending}>
        {pending ? "Connecting + first sync (can take a minute)…" : "Connect RiseUp"}
      </button>
    </form>
  );
}

function FinancyPanel({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await connectFinancy(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
      onDone();
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-3">
      <p className="text-[13px] text-muted">
        1. In the{" "}
        <a
          href="https://financy.open-finance.ai/"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-accent"
        >
          Financy
        </a>{" "}
        app, link your banks and cards (open banking, supervised by the Bank
        of Israel).
        <br />
        2. Open <b>Settings → API access</b> there and copy the three values
        below. The API needs a paid Financy plan.
        <br />
        3. Peanut only reads: accounts, balances and transactions.
      </p>
      <input
        name="client_id"
        className={inputCls}
        placeholder="Client id"
        autoComplete="off"
      />
      <input
        name="client_secret"
        type="password"
        className={inputCls}
        placeholder="Client secret"
        autoComplete="off"
      />
      <input
        name="user_id"
        className={inputCls}
        placeholder="User id"
        autoComplete="off"
      />
      <p className="text-[12px] text-faint">
        The secret is stored encrypted in Supabase Vault and never shown again.
        The first sync pulls 12 months of transactions with Financy&apos;s
        categories and a year of daily balances for your bank accounts.
      </p>
      {error ? <p className="text-[13px] text-neg">{error}</p> : null}
      <button className={buttonCls("primary")} disabled={pending}>
        {pending ? "Connecting + first sync (can take a minute)…" : "Connect Financy"}
      </button>
    </form>
  );
}

function PensionPanel({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      await addPensionAccount(formData);
      router.refresh();
      onDone();
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-3">
      <p className="text-[13px] text-muted">
        Enter the balance from your last statement. Each month Peanut applies
        the fund track&apos;s official published yield (data.gov.il) minus
        your fee, plus your monthly deposit. Re-anchor when a new statement
        arrives.
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        <input name="name" className={inputCls} placeholder="Name (e.g. Meitav Pension)" />
        <select name="provider" className={selectCls} defaultValue="Meitav">
          <option>Meitav</option>
          <option>Menorah</option>
          <option>Clal</option>
          <option>Phoenix</option>
          <option>Harel</option>
          <option>Migdal</option>
          <option>Altshuler</option>
          <option>Other</option>
        </select>
        <select name="dataset" className={selectCls} defaultValue="pensianet">
          <option value="pensianet">Pension fund (Pensianet)</option>
          <option value="gemelnet">Gemel / Hishtalmut (Gemelnet)</option>
        </select>
        <input
          name="fund_id"
          type="number"
          className={inputCls}
          placeholder="Track # (מספר מסלול)"
        />
        <input name="balance" type="number" step="0.01" className={inputCls} placeholder="Balance ₪" />
        <input name="anchor_date" type="date" className={inputCls} />
        <input
          name="annual_fee_pct"
          type="number"
          step="0.01"
          className={inputCls}
          placeholder="Annual fee % (e.g. 0.6)"
        />
        <input
          name="monthly_contribution"
          type="number"
          step="0.01"
          className={inputCls}
          placeholder="Monthly deposit ₪"
        />
      </div>
      <p className="text-[12px] text-faint">
        The track number is on every statement (מספר מסלול באוצר). Leave it
        empty to track this account by hand.
      </p>
      <button className={buttonCls("primary")} disabled={pending}>
        {pending ? "Adding…" : "Add pension"}
      </button>
    </form>
  );
}

function ManualPanel({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      await addManualAccount(formData);
      router.refresh();
      onDone();
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2.5">
        <input name="name" className={inputCls} placeholder="Account name" />
        <input name="institution" className={inputCls} placeholder="Institution (optional)" />
        <select name="type" className={selectCls} defaultValue="checking">
          <option value="checking">Checking</option>
          <option value="savings">Savings</option>
          <option value="cash">Cash</option>
          <option value="credit">Credit card</option>
          <option value="investment">Investment</option>
          <option value="pension">Pension</option>
          <option value="loan">Loan</option>
          <option value="property">Property</option>
          <option value="vehicle">Vehicle</option>
          <option value="other_asset">Other asset</option>
          <option value="other_liability">Other liability</option>
        </select>
        <select name="currency" className={selectCls} defaultValue="ILS">
          <option value="ILS">₪ ILS</option>
          <option value="USD">$ USD</option>
        </select>
        <input
          name="balance"
          type="number"
          step="0.01"
          className={inputCls}
          placeholder="Current balance"
        />
      </div>
      <button className={buttonCls("primary")} disabled={pending}>
        {pending ? "Adding…" : "Add account"}
      </button>
    </form>
  );
}
