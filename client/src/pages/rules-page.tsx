import { Link, useParams } from "react-router-dom";
import { ArrowLeft, BookOpen, Scale } from "lucide-react";
import { RULE_DOCS, ruleDoc, type RuleDoc } from "@/lib/rules";

export function RulesIndexPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-12 pt-10 sm:px-6">
      <p className="label flex items-center gap-2">
        <BookOpen className="h-4 w-4" /> House rules
      </p>
      <h1 className="mt-2 font-display text-4xl text-parchment-100 sm:text-5xl">
        Everything at the table
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-parchment-200/60">
        20 Down, the fairness model, and the wagering terms. Free play never touches a wallet.
        USDC wagering is mainnet-only and currently paused pending audit and legal sign-off.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {RULE_DOCS.map((doc) => (
          <Link
            key={doc.slug}
            to={`/rules/${doc.slug}`}
            className="panel group p-5 transition hover:-translate-y-0.5 hover:border-brass-400/30"
          >
            <p className="label">{doc.chips[0]}</p>
            <h2 className="mt-1 font-display text-2xl text-parchment-100">{doc.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-parchment-200/55">{doc.subtitle}</p>
            <p className="mt-4 text-xs text-brass-300 opacity-70 transition group-hover:opacity-100">
              Read the rules →
            </p>
          </Link>
        ))}
        <div className="panel flex items-start gap-3 p-5">
          <Scale className="mt-0.5 h-4 w-4 shrink-0 text-brass-300" />
          <p className="text-xs leading-relaxed text-parchment-200/55">
            Need a break? Help and support are available at{" "}
            <a
              href="https://www.begambleaware.org/"
              target="_blank"
              rel="noreferrer noopener"
              className="text-brass-300 hover:text-brass-400"
            >
              BeGambleAware.org
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}

export function RulesPage() {
  const { slug } = useParams<{ slug: string }>();
  const doc = slug ? ruleDoc(slug) : null;
  if (!doc) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <p className="font-display text-2xl text-parchment-100">Rules not found</p>
        <Link to="/rules" className="btn-ghost mt-5">
          <ArrowLeft className="h-4 w-4" /> All rules
        </Link>
      </div>
    );
  }
  return <RuleDocument doc={doc} />;
}

function RuleDocument({ doc }: { doc: RuleDoc }) {
  return (
    <article className="mx-auto max-w-3xl px-4 pb-12 pt-10 sm:px-6">
      <Link to="/rules" className="btn-quiet !px-0 py-1 text-xs">
        <ArrowLeft className="h-3 w-3" /> All rules
      </Link>
      <p className="label mt-6 flex flex-wrap gap-2">
        {doc.chips.map((chip) => (
          <span key={chip} className="chip !py-1 !text-[9px]">
            {chip}
          </span>
        ))}
      </p>
      <h1 className="mt-4 font-display text-4xl text-parchment-100 sm:text-5xl">{doc.title}</h1>
      <p className="mt-3 text-base leading-relaxed text-parchment-200/65">{doc.subtitle}</p>
      <p className="mt-6 leading-relaxed text-parchment-200/80">{doc.intro}</p>

      <div className="mt-8 space-y-4">
        {doc.sections.map((section) => (
          <section key={section.title} className="panel p-5 sm:p-6">
            <h2 className="font-display text-xl text-parchment-100">{section.title}</h2>
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph} className="mt-3 text-sm leading-relaxed text-parchment-200/65">
                {paragraph}
              </p>
            ))}
            {section.bullets ? (
              <ul className="mt-3 space-y-2 text-sm text-parchment-200/65">
                {section.bullets.map((bullet) => (
                  <li key={bullet} className="flex gap-2">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brass-400" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {section.example ? (
              <p className="mt-4 rounded-xl border border-brass-400/25 bg-brass-500/[0.06] px-4 py-3 font-mono text-xs leading-relaxed text-brass-300">
                {section.example}
              </p>
            ) : null}
          </section>
        ))}
      </div>

      {doc.playHref ? (
        <Link to={doc.playHref} className="btn-primary mt-8">
          Back to the lobby <ArrowLeft className="h-4 w-4 rotate-180" />
        </Link>
      ) : null}
    </article>
  );
}
