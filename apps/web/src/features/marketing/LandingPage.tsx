"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";

function HeroBackdrop() {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/hero-bottleneck.png"
        alt=""
        className="absolute inset-0 h-full w-full scale-105 object-cover object-[68%_center] animate-[heroDrift_28s_ease-in-out_infinite_alternate]"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-[#07140f]/82 via-[#0b1a14]/45 to-[#0b1a14]/20" />
    </div>
  );
}

function usePrimaryCta() {
  const { user, ready } = useAuth();
  // Keep SSR and first client paint identical; switch after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const signedIn = mounted && ready && Boolean(user);
  return {
    href: signedIn ? "/projects" : "/sign-in",
    label: signedIn ? "Open workspace" : "Sign in",
  };
}

export function LandingPage() {
  const { href: primaryHref, label: primaryLabel } = usePrimaryCta();

  return (
    <div className="min-h-dvh bg-[var(--hl-paper)] text-[var(--hl-ink)]">
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <span className="font-display text-xl font-semibold tracking-tight text-white">
            HighLife
          </span>
          <Link
            href={primaryHref}
            className="rounded-md bg-white/95 px-3.5 py-1.5 text-sm font-medium text-[var(--hl-moss-deep)] transition hover:bg-white"
          >
            {primaryLabel}
          </Link>
        </div>
      </header>

      <section className="relative flex min-h-dvh items-end overflow-hidden pb-16 pt-28 sm:items-center sm:pb-0 sm:pt-0">
        <HeroBackdrop />

        <div className="relative z-10 mx-auto w-full max-w-6xl px-5 sm:px-8">
          <p className="font-display animate-fade-up text-5xl font-semibold tracking-tight text-white sm:text-7xl md:text-8xl">
            HighLife
          </p>
          {/* Hero: approval-time bottleneck → housing outcome */}
          <h1 className="animate-fade-up-delay-1 mt-4 max-w-2xl text-2xl font-medium leading-snug text-white/95 sm:text-3xl">
            The bottleneck isn&apos;t just land or labour—it&apos;s approval time.
          </h1>
          <p className="animate-fade-up-delay-2 mt-3 max-w-xl text-base leading-relaxed text-white/75">
            HighLife automates design policy checks so compliant homes move from drawing board to
            construction in days, not months. Faster approvals. More homes.
          </p>
          <div className="animate-fade-up-delay-3 mt-8">
            <Link
              href={primaryHref}
              className="inline-flex rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-[var(--hl-moss-deep)] transition hover:bg-[var(--hl-mist)]"
            >
              {primaryLabel}
            </Link>
          </div>
        </div>
      </section>

      <section id="victoria" className="border-b border-[var(--hl-line)] bg-white">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            From drawing board to construction in days, not months
          </h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-slate-600">
            Australia&apos;s housing shortage is often framed as land or labour. Approval time is the
            quieter bottleneck. HighLife uses computer vision and AI to check building designs
            against residential codes and local policy—so compliance stays rigorous, and timelines
            get shorter. That sits alongside digital assessment work such as{" "}
            <a
              href="https://www.land.vic.gov.au/maps-and-spatial/digital-twin-victoria/ecomply"
              className="text-[var(--hl-moss)] underline-offset-2 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              Digital Twin Victoria&apos;s eComply
            </a>
            .
          </p>

          {/* TODO: optional metrics row (avg days saved, first-pass rate) */}
          <ul className="mt-12 grid gap-10 sm:grid-cols-3">
            {[
              {
                title: "Months of checking → days of validation",
                body: "Automated policy checks replace slow, manual compliance reviews without watering down the rules.",
              },
              {
                title: "Faster, more consistent decisions",
                body: "Same clauses, applied the same way—so councils and certifiers get auditable outcomes, not guesswork.",
              },
              {
                title: "Faster approvals. More homes.",
                body: "Shorter timelines mean fewer redesign loops, lower holding costs, and earlier starts on site.",
              },
            ].map((item) => (
              <li key={item.title} className="border-t border-[var(--hl-line)] pt-5">
                <h3 className="font-display text-xl font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="features" className="border-b border-[var(--hl-line)] bg-[var(--hl-mist)]/30">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            What HighLife does
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600">
            HighLife automates building design policy approval with computer vision and AI. It
            checks residential designs against design codes and local policies—faster and more
            consistently, not more loosely.
          </p>

          {/* TODO: product screenshot / workspace preview */}
          <ul className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                title: "Automated policy checks",
                body: "Validate plans against residential design codes and local planning requirements.",
              },
              {
                title: "Clause-referenced feedback",
                body: "Designers get instant, specific feedback they can act on before lodgement.",
              },
              {
                title: "Structured compliance reports",
                body: "Councils and certifiers receive clear, auditable findings tied to the drawing.",
              },
              {
                title: "Fewer redesign cycles",
                body: "Catch issues early so projects spend less time looping between design and approval.",
              },
            ].map((item) => (
              <li key={item.title} className="border-t border-[var(--hl-line)] pt-5">
                <h3 className="font-display text-lg font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          How it works
        </h2>
        <p className="mt-3 max-w-2xl text-base text-slate-600">
          From upload to a structured compliance report—built for shorter approval timelines.
        </p>

        <ol className="mt-12 grid gap-10 sm:grid-cols-3">
          {[
            {
              step: "01",
              title: "Upload the design",
              body: "Add a residential floor plan and set the jurisdiction and policy version.",
            },
            {
              step: "02",
              title: "Automate the checks",
              body: "Computer vision and AI validate the design against residential codes and local rules.",
            },
            {
              step: "03",
              title: "Review and approve faster",
              body: "Designers fix issues with clause-referenced feedback. Assessors get a clear compliance report.",
            },
          ].map((item) => (
            <li key={item.step} className="border-t border-[var(--hl-line)] pt-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--hl-moss)]">
                {item.step}
              </p>
              <h3 className="mt-3 font-display text-xl font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="who" className="border-t border-[var(--hl-line)] bg-white">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Who it&apos;s for
          </h2>
          {/* TODO: optional customer logos (councils, certifiers, builders) */}
          <div className="mt-12 grid gap-10 sm:grid-cols-3">
            {[
              {
                title: "Councils and private certifiers",
                body: "Faster first-pass assessments, consistent and auditable decisions, and more capacity for complex applications.",
              },
              {
                title: "Architects and designers",
                body: "Instant clause-referenced feedback before lodgement, fewer redesign cycles, and a clearer path to approval.",
              },
              {
                title: "Developers and volume builders",
                body: "Shorter approval timelines, lower holding costs and risk, and faster time to construction and sales.",
              },
            ].map((item) => (
              <div key={item.title} className="border-t border-[var(--hl-line)] pt-5">
                <h3 className="font-display text-xl font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--hl-line)] bg-[var(--hl-mist)]/40">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-16 sm:flex-row sm:items-end sm:justify-between sm:px-8">
          <div className="max-w-xl">
            <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              Faster approvals. More homes.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              HighLife automates building design approval to remove the approval-time bottleneck in
              Australia&apos;s housing crisis. It supports assessment—it does not replace statutory
              approval. Sign in to open the workspace.
            </p>
          </div>
          <Link
            href={primaryHref}
            className="inline-flex shrink-0 rounded-md bg-[var(--hl-moss)] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--hl-moss-deep)]"
          >
            {primaryLabel}
          </Link>
        </div>
      </section>

      <footer className="border-t border-[var(--hl-line)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span className="font-display text-base font-semibold text-[var(--hl-ink)]">HighLife</span>
          <p>Automated policy checks. Statutory approval stays with the assessor.</p>
          <Link href="/sign-in" className="text-[var(--hl-moss)] hover:underline">
            Sign in
          </Link>
        </div>
      </footer>
    </div>
  );
}
