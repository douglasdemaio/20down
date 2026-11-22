import { Link } from "react-router-dom";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-white/10 bg-ink-950/60">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div>
          <p className="font-display text-lg text-parchment-100">20 Down</p>
          <p className="mt-2 max-w-xs text-xs leading-relaxed text-parchment-200/50">
            A three- or four-player trick-taking game. Free tables with bots, and mainnet USDC
            tables escrowed by an open-source Solana program.
          </p>
        </div>
        <div>
          <p className="label mb-3">Play</p>
          <ul className="space-y-2 text-sm text-parchment-200/60">
            <li><Link className="hover:text-parchment-100" to="/">Lobby</Link></li>
            <li><Link className="hover:text-parchment-100" to="/rules">House rules</Link></li>
            <li><Link className="hover:text-parchment-100" to="/verify">Verify a round</Link></li>
          </ul>
        </div>
        <div>
          <p className="label mb-3">Fair play</p>
          <ul className="space-y-2 text-sm text-parchment-200/60">
            <li><Link className="hover:text-parchment-100" to="/rules/fairness">Seeds &amp; verification</Link></li>
            <li><Link className="hover:text-parchment-100" to="/rules/wagering">Fees &amp; escrow</Link></li>
            <li><Link className="hover:text-parchment-100" to="/settings">Session controls</Link></li>
          </ul>
        </div>
        <div>
          <p className="label mb-3">Play safely</p>
          <p className="text-xs leading-relaxed text-parchment-200/50">
            18+ only. Wagering is not available in every jurisdiction. If play stops being fun,
            take a break.
          </p>
          <a
            href="https://www.begambleaware.org/"
            target="_blank"
            rel="noreferrer noopener"
            className="mt-3 inline-block text-xs text-brass-300 hover:text-brass-400"
          >
            BeGambleAware.org →
          </a>
        </div>
      </div>
      <div className="border-t border-white/5 px-4 py-4 text-center font-mono text-[10px] uppercase tracking-widest text-parchment-200/30">
        Free play available everywhere permitted · USDC wagering pending audit &amp; legal review
      </div>
    </footer>
  );
}
