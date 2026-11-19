// Built-in quests shipped with the app. Signed packs can change these, but cannot add new ids:
// the static build only has pages for these ids.
import type { QuestDef } from "./quests";

export const QUESTS: QuestDef[] = [
  {
    id: "q47", type: "locate_prove", title: "The Wall Remembers", rewardPoints: 500, rewardCoins: 2,
    description: "A survivor left a message on the third arch. Film it and say the day's code word to prove you were there.",
    stages: [
      { id: "find", kind: "visit", text: "Reach the third arch of the Old City Wall.", lat: 12.0022, lng: 8.592, radiusM: 100 },
      { id: "record", kind: "record", text: "Record your evidence (15 s max)." },
    ],
  },
  {
    id: "q48", type: "build_make", title: "Signal Fire", rewardPoints: 400, rewardCoins: 1,
    description: "Build a signal structure from local materials. Film it working.",
    stages: [
      { id: "find", kind: "visit", text: "Go to Kurmi Market gate.", lat: 11.9985, lng: 8.5167, radiusM: 150 },
      { id: "record", kind: "record", text: "Record the working signal (15 s max)." },
    ],
  },
  {
    id: "q49", type: "interview", title: "The Historian", rewardPoints: 300, rewardCoins: 1,
    description: "Interview a local person about the history of this place. Film the interview.",
    stages: [
      { id: "find", kind: "visit", text: "Go to the base of Dala Hill.", lat: 11.9999, lng: 8.5353, radiusM: 200 },
      { id: "record", kind: "record", text: "Record the interview (15 s max)." },
    ],
  },
];

export const QUEST_TYPE_LABEL: Record<QuestDef["type"], string> = {
  locate_prove: "Locate & Prove",
  build_make: "Build / Make",
  decode_act: "Decode & Act",
  interview: "Interview",
  relay: "Relay",
};

export const SCAVENGE_POINTS: import("./game").ScavengePoint[] = [
  { id: "sp-wall", name: "Old City Wall, third arch", lat: 12.0022, lng: 8.592 },
  { id: "sp-market", name: "Kurmi Market gate", lat: 11.9985, lng: 8.5167 },
  { id: "sp-hill", name: "Dala Hill base", lat: 11.9999, lng: 8.5353 },
];
