# The Collapse — Paper Prototype Rulebook (Phase 0)

Source: "The Collapse — Full Technical Specification", sections 1–4, 6, and the Phase 0 deliverable.
Status: **draft for the 10-friend offline playtest.** Items marked **[OPEN]** are not fixed by the spec and must be decided during playtesting.

## 1. Core loop

Scavenge → Quest → Trade → Relay → repeat.

1. **Scavenge.** Visit a real scavenge point (within 100 m). Scan its QR. Get a random commodity. Cooldown 4 h per player per point.
2. **Quest.** Complete a quest near a location. Record evidence on a phone camera (paper: a witnessed "video" by a referee). Quest has a daily code word and an expiry time.
3. **Trade.** Swap commodities with another player face to face (direct barter), or pay coins.
4. **Relay.** Carry a sealed scroll to a destination. Reward is paid only on delivery, never on pickup.

## 2. Commodities

| ID | Name | Rarity | Scavenge chance | Quantity per find |
|---|---|---|---|---|
| grain | Grain | Common | 60% | 1–4 |
| water | Water | Common | 25% | 1–3 |
| fuel | Fuel | Uncommon | 10% | 1 |
| tools | Tools | Rare | 4% | 1 |
| medicine | Medicine | Rare | 1% | 1 |

Each scavenge also gives **+25 XP**.

## 3. Quests (5 types)

Each quest has a title, a location with radius, a daily code word, a time limit, and a reward (points + coins).

| Type | What the player does | Example (paper) |
|---|---|---|
| **Locate & Prove** | Find a place and prove presence on camera, saying the day's code word | "The Wall Remembers": film yourself at the third arch of the Old City Wall and say the code word. 500 pts, 2 coins. |
| **Build / Make** | Make something from local materials and film the result | "Signal Fire": build a signal structure from found materials; film it working. |
| **Decode & Act** | Solve a riddle found on site; the answer names the next location | "Hill Riddle": a riddle carved on a landmark; the answer is the place name for Quest 2. |
| **Interview** | Interview a local person about a topic and film it | "The Historian": ask a local about the history of a place. |
| **Relay** | Carry a sealed scroll to a destination (see §5) | "Deliver to Oba's Market, Gate 3." |

Example reward levels from the spec: quest 500 pts + 2 coins; scroll 50 coins + 100 XP.

**[OPEN]** Exact point/coin values per quest type, and how many quests per week.

## 4. Coins

- **Genesis.** A fixed number of coins is minted once, offline, and split across a pre-set allocation plan. Each coin starts with one genesis transfer record and value 1.
- **Supply is fixed.** No new coins after genesis except from the pre-allocated prize pool. Relays earn fees, not new coins.
- **Transfer.** A coin moves by a signed transfer from holder to receiver. Each coin carries its full chain of transfers.
- **Spending.** Coins pay for commodities or scrolls. Pay in person; receiver confirms by signed receipt.
- **Double-spend.** Detected at reconciliation (when devices sync), not prevented in real time. The duplicate is flagged; the player is reviewed.
- **[OPEN]** Total coin count, allocation plan, and the paper version of "signature" (initialled ledger card is suggested).

## 5. Lucky Courier (scrolls)

- The game master creates a scroll with a destination, a reward, and a 24 h expiry.
- A player who takes a scroll gets the destination label and a code.
- Reward is paid on delivery only, when the destination confirms the code.
- Scroll expiry: 24 h. Reward: coins + XP (example: 50 coins, 100 XP).

## 6. Trade (paper version)

1. Both players agree on an offer: "I give 1 medicine, you give 5 grain."
2. Both show the offer on paper.
3. Both confirm (initial the trade card).
4. Trade is recorded on the ledger card. Coins in the trade follow §4.

## 7. Scoring and elimination

- **Points.** Quests give points. Scrolls give XP. Trades give points **[OPEN]**.
- **Weekly worlds.** A season has 4 weeks ("World"). Each world is one week of play with its own leaderboard. Top 20 are shown; the player sees their own rank.
- **Boss event.** At the end of a world, the top 10 players in a zone attend a physical challenge in three parts: (A) build a signal structure, (B) decode a riddle to find Part C's location, (C) interview a local historian. Boss results carry bonus points **[OPEN]**.
- **Elimination.** **[OPEN]** — the spec does not define elimination. Decide during playtest: none, or lowest-ranked players leave each world.

## 8. Fair play rules (paper)

- Quest evidence must be recorded in view of a referee in the paper prototype.
- Relays and trades are honest-by-default; cheating is reported and reviewed.
- Nothing hidden: every player can see the rules and their own record.

## 9. Playtest protocol (for `/docs/paper-prototype-findings.md`)

- 10 friends, offline, one local area, at least one full world.
- Record for each: what was fun, what was confusing, what took too long, which rules were argued over, and what the player would change.
- Findings decide Phase 1 scope. Update this rulebook and the spec before Phase 1 starts.
