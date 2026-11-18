import { notFound } from "next/navigation";
import { QUESTS, QUEST_TYPE_LABEL } from "@/lib/seed";

export default function QuestDetail({ params }: { params: { id: string } }) {
  const q = QUESTS.find((x) => x.id === params.id);
  if (!q) notFound();
  return (
    <>
      <div className="muted">Quest · {QUEST_TYPE_LABEL[q.type]}</div>
      <h1>{q.title}</h1>
      <div className="card">
        <p>{q.description}</p>
        <p className="muted">Radius {q.radiusM} m · Reward {q.rewardPoints} pts, {q.rewardCoins} coins</p>
      </div>
      <div className="card muted">
        Evidence recording (in-app camera, GPS trail) is not built yet. Quests are read-only in this build.
      </div>
    </>
  );
}
