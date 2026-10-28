import Link from "next/link";
import { ExternalLink, Mail } from "lucide-react";
import { PeanutMark } from "./logo";
import { buttonCls } from "./ui";
import { REPO_URL, contactEmail, isDemoDeployment } from "@/lib/demo/config";

/** Who made Peanut and where to get it. Shown at /contact and for unknown URLs. */
export function ContactCard({ note }: { note?: string }) {
  const email = contactEmail();
  const demo = isDemoDeployment();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-bg px-4 py-10">
      <div className="flex items-center gap-2.5">
        <PeanutMark size={34} />
        <span className="text-[26px] font-semibold tracking-tight">peanut</span>
      </div>
      <div className="card w-full max-w-[520px] p-7">
        {note ? <p className="mb-3 text-[12.5px] font-medium text-muted">{note}</p> : null}
        <h1 className="mb-3 text-[19px] font-semibold">Household finance for dollars and shekels</h1>
        <p className="mb-3 text-[14px] leading-relaxed text-ink-soft">
          Peanut is an open-source finance app for families who live in two countries at
          once: US and Israeli banks and cards, pensions, budgets, recurring bills, goals,
          investments and a retirement forecast, with each currency kept separate instead
          of mashed into one number.
        </p>
        {demo ? (
          <p className="mb-5 text-[14px] leading-relaxed text-ink-soft">
            This site runs a public demo with made-up data. It resets every couple of
            hours, and nothing you do in it leaves the sandbox. To use Peanut with your
            own accounts, run it yourself from the source.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {demo ? (
            <Link href="/demo" className={buttonCls("primary")}>
              Open the demo
            </Link>
          ) : null}
          <a href={REPO_URL} target="_blank" rel="noreferrer" className={buttonCls("secondary")}>
            <ExternalLink size={15} className="mr-1.5 inline" />
            Source on GitHub
          </a>
          {email ? (
            <a href={`mailto:${email}`} className={buttonCls("secondary")}>
              <Mail size={15} className="mr-1.5 inline" />
              Email Jacob
            </a>
          ) : null}
        </div>
      </div>
      <p className="text-[12.5px] text-muted">Made by Jacob Namrow. MIT licensed.</p>
    </div>
  );
}
