import { VerifyClient } from "./verify-client";

export const metadata = {
  title: "Verify a round",
  description:
    "Re-derive the dice for any published Dice & Cards round from the revealed seed and reroll masks.",
};

export default function VerifyPage({
  searchParams,
}: {
  searchParams?: { room?: string; round?: string };
}) {
  return <VerifyClient initialRoom={searchParams?.room ?? ""} initialRound={searchParams?.round ?? ""} />;
}
