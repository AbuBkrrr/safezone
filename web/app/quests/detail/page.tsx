"use client";
import { useEffect, useState } from "react";
import { QuestView } from "@/components/QuestView";

// One static page serves every quest, including ones added by packs. The id comes from ?id=.
export default function QuestDetail() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => setId(new URLSearchParams(window.location.search).get("id")), []);
  if (id === null) return <p className="muted">Loading…</p>;
  return <QuestView id={id} />;
}
