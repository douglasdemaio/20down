import Link from "next/link";
import { Dices } from "lucide-react";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-brass-400/40 bg-brass-500/10 text-brass-300">
        <Dices className="h-7 w-7" />
      </span>
      <h1 className="mt-6 font-display text-4xl text-parchment-100">Wrong table</h1>
      <p className="mt-3 text-sm leading-relaxed text-parchment-200/55">
        Nobody is dealing at the corner of the internet. Try the lobby instead.
      </p>
      <Link href="/" className="btn-primary mt-6">
        Back to the lobby
      </Link>
    </div>
  );
}
