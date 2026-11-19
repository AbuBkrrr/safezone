import { QUESTS } from "@/lib/seed";
import { QuestView } from "@/components/QuestView";

export function generateStaticParams() {
  return QUESTS.map((q) => ({ id: q.id }));
}

export default function QuestDetail({ params }: { params: { id: string } }) {
  return <QuestView id={params.id} />;
}
