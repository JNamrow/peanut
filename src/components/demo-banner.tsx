import Link from "next/link";
import { ExternalLink, FlaskConical } from "lucide-react";
import { REPO_URL } from "@/lib/demo/config";

/** Shown on every page of a demo deployment. */
export function DemoBanner() {
  return (
    <div className="mx-6 mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-accent/30 bg-accent-soft px-3.5 py-2 text-[12.5px]">
      <span className="inline-flex items-center gap-1.5 font-semibold text-accent-strong">
        <FlaskConical size={14} /> Demo
      </span>
      <span className="text-ink-soft">
        A shared household with made-up data. Click around, change things, it resets every
        couple of hours.
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        <Link
          href="/contact"
          className="rounded-md px-2 py-1 font-medium text-ink-soft hover:bg-hover hover:text-ink"
        >
          About
        </Link>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 font-medium text-white hover:bg-accent-strong"
        >
          <ExternalLink size={13} /> Get Peanut
        </a>
      </span>
    </div>
  );
}
