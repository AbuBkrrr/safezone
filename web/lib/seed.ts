import type { Quest, ScavengePoint } from "./game";

// Seed data for one pilot city (placeholder coordinates, Kano area per the spec).
export const SCAVENGE_POINTS: ScavengePoint[] = [
  { id: "sp-wall", name: "Old City Wall, third arch", lat: 12.0022, lng: 8.592 },
  { id: "sp-market", name: "Kurmi Market gate", lat: 11.9985, lng: 8.5167 },
  { id: "sp-hill", name: "Dala Hill base", lat: 11.9999, lng: 8.5353 },
];

export const QUESTS: Quest[] = [
  {
    id: "q47",
    type: "locate_prove",
    title: "The Wall Remembers",
    description:
      "A survivor left a message on the third arch. Film it and say the day's code word to prove you were there.",
    lat: 12.0022,
    lng: 8.592,
    radiusM: 100,
    rewardPoints: 500,
    rewardCoins: 2,
  },
  {
    id: "q48",
    type: "build_make",
    title: "Signal Fire",
    description: "Build a signal structure from local materials. Film it working.",
    lat: 11.9985,
    lng: 8.5167,
    radiusM: 150,
    rewardPoints: 400,
    rewardCoins: 1,
  },
  {
    id: "q49",
    type: "interview",
    title: "The Historian",
    description: "Interview a local person about the history of this place. Film the interview.",
    lat: 11.9999,
    lng: 8.5353,
    radiusM: 200,
    rewardPoints: 300,
    rewardCoins: 1,
  },
];

export const QUEST_TYPE_LABEL: Record<Quest["type"], string> = {
  locate_prove: "Locate & Prove",
  build_make: "Build / Make",
  decode_act: "Decode & Act",
  interview: "Interview",
  relay: "Relay",
};
