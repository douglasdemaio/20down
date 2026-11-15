import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Info } from "lucide-react";
import { RULE_DOCS, ruleDoc } from "@/lib/rules";

export function generateStaticParams() {
  return RULE_DOCS.map((doc) => ({ game: doc.slug }));
}

export function generateMetadata({ params }: { params: { game: string } }): Metadata {
  const doc = ruleDoc(params.game);
  if (!doc) return { title: "Rules" };
  return { title: doc.title, description: doc.subtitle };
}

export default function RulePage({ params }: { params: { game: string } }) {
  const doc = ruleDoc(params.game);
  if (!doc) notFound();

  return (
    <div className="mx-auto max-w-6xl px-4 pb-12 pt-8 sm:px-6">
      <Link href="/rules" className="btn-quiet !px-0 !py-2 text-xs">
        <ArrowLeft className="h-3.5 w-3.5" /> All house rules
      </Link>

      <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_260px]">
        <article>
          <header className="relative overflow-hidden rounded-3xl border border-white/10 bg-ink-900/50 px-6 py-8 shadow-card sm:px-8">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_10%,rgba(212,168,79,0.14),transparent_45%),radial-gradient(circle_at_5%_100%,rgba(29,107,82,0.22),transparent_55%)]" />
            <div className="relative">
              <p className="label">House rules</p>
              <h1 className="mt-2 font-display text-4xl text-parchment-100">{doc.title}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-parchment-200/65 sm:text-base">
                {doc.intro}
              </p>
              <div className="mt-5 flex flex-wrap gap-1.5">
                {doc.chips.map((chip) => (
                  <span key={chip} className="chip">
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          </header>

          <div className="mt-8 space-y-8">
            {doc.sections.map((section, index) => (
              <section key={section.title} id={`section-${index + 1}`}>
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border border-brass-400/40 bg-brass-500/10 font-mono text-xs text-brass-300">
                    {index + 1}
                  </span>
                  <h2 className="font-display text-2xl text-parchment-100">{section.title}</h2>
                </div>
                <div className="mt-3 space-y-3 pl-10">
                  {section.paragraphs?.map((paragraph) => (
                    <p key={paragraph} className="text-sm leading-relaxed text-parchment-200/70">
                      {paragraph}
                    </p>
                  ))}
                  {section.bullets ? (
                    <ul className="space-y-2">
                      {section.bullets.map((bullet) => (
                        <li
                          key={bullet}
                          className="flex items-start gap-2 text-sm leading-relaxed text-parchment-200/70"
                        >
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brass-400/70" />
                          {bullet}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {section.example ? (
                    <div className="flex items-start gap-2 rounded-xl border border-brass-400/25 bg-brass-500/[0.07] px-3.5 py-3 text-sm leading-relaxed text-parchment-200/75">
                      <Info className="mt-0.5 h-4 w-4 shrink-0 text-brass-300" />
                      <p>
                        <span className="font-semibold text-brass-300">Example. </span>
                        {section.example}
                      </p>
                    </div>
                  ) : null}
                </div>
              </section>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brass-400/25 bg-brass-500/[0.06] px-5 py-4">
            <p className="text-sm text-parchment-200/65">
              The code enforces these rules on every table.
            </p>
            <div className="flex gap-2">
              <Link href="/rules" className="btn-ghost py-2 text-xs">
                More rules
              </Link>
              <Link href={doc.playHref ?? "/"} className="btn-primary py-2 text-xs">
                Find a table <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </article>

        <aside className="hidden lg:block">
          <div className="panel sticky top-24 p-4">
            <p className="label mb-3">On this page</p>
            <ol className="space-y-2">
              {doc.sections.map((section, index) => (
                <li key={section.title}>
                  <a
                    href={`#section-${index + 1}`}
                    className="block text-xs leading-snug text-parchment-200/55 transition hover:text-parchment-100"
                  >
                    {index + 1}. {section.title}
                  </a>
                </li>
              ))}
            </ol>
            <div className="divider my-4" />
            <p className="text-[10px] leading-relaxed text-parchment-200/35">
              Wager play is 18+ and only where legal. Free tables never touch a wallet.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
