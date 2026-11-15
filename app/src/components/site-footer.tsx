import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-white/10 bg-ink-950/60">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div>
          <p className="font-display text-lg text-parchment-100">Dice &amp; Cards</p>
          <p className="mt-2 max-w-xs text-xs leading-relaxed text-parchment-200/50">
            Free multiplayer dice and card games, with optional USDC tables escrowed by an
            open-source Solana program.
          </p>
        </div>
        <div>
          <p className="label mb-3">Play</p>
          <ul className="space-y-2 text-sm text-parchment-200/60">
            <li><Link className="hover:text-parchment-100" href="/">Lobby</Link></li>
            <li><Link className="hover:text-parchment-100" href="/rules">House rules</Link></li>
            <li><Link className="hover:text-parchment-100" href="/verify">Verify a round</Link></li>
          </ul>
        </div>
        <div>
          <p className="label mb-3">Fairness</p>
          <ul className="space-y-2 text-sm text-parchment-200/60">
            <li><Link className="hover:text-parchment-100" href="/rules/fairness">Seeds &amp; VRF</Link></li>
            <li><Link className="hover:text-parchment-100" href="/rules/wagering">Wagering &amp; fees</Link></li>
            <li>
              <a
                className="hover:text-parchment-100"
                href="https://explorer.solana.com/address/CrjnJ5xQjSYUw4vkKKRfWtQFCc58EoA82ZXodNDwjHXt?cluster=devnet"
                target="_blank"
                rel="noreferrer noopener"
              >
                Escrow program ↗
              </a>
            </li>
          </ul>
        </div>
        <div>
          <p className="label mb-3">Play responsibly</p>
          <ul className="space-y-2 text-sm text-parchment-200/60">
            <li>18+ only where wagering is legal</li>
            <li>
              <a
                className="text-brass-300 hover:text-brass-400"
                href="https://www.begambleaware.org/"
                target="_blank"
                rel="noreferrer noopener"
              >
                BeGambleAware.org ↗
              </a>
            </li>
            <li>Session loss limits are enforced in-app</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/5 px-4 py-4">
        <p className="mx-auto max-w-7xl font-mono text-[10px] uppercase tracking-wider text-parchment-200/35">
          Devnet build · Wager play is experimental · Never wager more than you can afford to lose
        </p>
      </div>
    </footer>
  );
}
