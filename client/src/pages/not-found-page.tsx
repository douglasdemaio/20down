import { Link } from "react-router-dom";
import { ArrowLeft, Spade } from "lucide-react";

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-brass-400/30 bg-brass-500/10 text-brass-300">
        <Spade className="h-5 w-5" />
      </span>
      <p className="label mt-6">404 · out of play</p>
      <h1 className="mt-2 font-display text-4xl text-parchment-100">That page isn&apos;t at the table</h1>
      <p className="mt-3 text-sm text-parchment-200/55">
        The link may be old, or the table may have been closed. Head back to the lobby to find an
        open seat.
      </p>
      <Link to="/" className="btn-primary mt-6">
        <ArrowLeft className="h-4 w-4" /> Back to the lobby
      </Link>
    </div>
  );
}
