"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { activeQuests } from "@/lib/content";
import { isComplete, type QuestDef } from "@/lib/quests";
import { loadState } from "@/lib/store";
import { QUEST_TYPE_LABEL } from "@/lib/seed";

export default function QuestsPage() {
  const [list, setList] = useState<QuestDef[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  useEffect(() => { setList(activeQuests()); setProgress(loadState().progress); }, []);
  return (
    <>
      <h1>Quests</h1>
      <p className="muted">Each quest has stages. Finish them in order. Rewards count after review.</p>
      {list.map((q) => {
        const p = progress[q.id] ?? 0;
        const status = isComplete(q, p) ? "Complete" : `Stage ${p + 1} of ${q.stages.length}`;
        return (
          <Link key={q.id} href={`/quests/${q.id}/`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
            <div className="card">
              <div className="row" style={{ borderTop: 0, padding: 0 }}><span className="muted">{QUEST_TYPE_LABEL[q.type]}</span><span className="tag">{status}</span></div>
              <strong>{q.title}</strong>
              <div className="muted">Reward {q.rewardPoints} pts, {q.rewardCoins} coins</div>
            </div>
          </Link>
        );
      })}
    </>
  );
}
