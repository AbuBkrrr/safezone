import { notFound } from "next/navigation";
import { QUESTS, QUEST_TYPE_LABEL } from "@/lib/seed";
import { QuestRecorder } from "./recorder";

export function generateStaticParams() {
  return QUESTS.map((q) => ({ id: q.id }));
}

export default function QuestDetail({ params }: { params: { id: string } }) {
  const q = QUESTS.find((x) => x.id === params.id);
  if (!q) notFound();
  return (
    <>
      <div className="muted">{QUEST_TYPE_LABEL[q.type]}</div>
      <h1>{q.title}</h1>
      <div className="card">
        <p style={{ marginTop: 0 }}>{q.description}</p>
        <div className="row"><span className="muted">Radius</span><span className="num">{q.radiusM} m</span></div>
        <div className="row"><span className="muted">Reward</span><span className="num">{q.rewardPoints} pts · {q.rewardCoins} coins</span></div>
      </div>
      <QuestRecorder questId={q.id} title={q.title} description={q.description} />
    </>
  );
}
