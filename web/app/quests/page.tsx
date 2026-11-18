import Link from "next/link";
import { QUESTS, QUEST_TYPE_LABEL } from "@/lib/seed";

export default function QuestsPage() {
  return (
    <>
      <h1>Quests</h1>
      {QUESTS.map((q) => (
        <Link key={q.id} href={`/quests/${q.id}`} style={{ textDecoration: "none", color: "inherit" }}>
          <div className="card">
            <div className="muted">{QUEST_TYPE_LABEL[q.type]}</div>
            <strong>{q.title}</strong>
            <div className="muted">Reward: {q.rewardPoints} pts, {q.rewardCoins} coins</div>
          </div>
        </Link>
      ))}
    </>
  );
}
