Trivia game system - requirements

Purpose
This document defines the functional and non-functional requirements for a small, locally-hosted, real-time trivia game intended for live audiences. It is focused on an MVP that supports teams joining without passwords, a gamemaster control panel, and a simple real-time scoreboard.

Goals
- Enable teams to join easily (no passwords) and submit answers in real time.
- Provide a gamemaster view to control rounds, inspect answers, mark correctness, and resolve scoring.
- Provide a minimal scoreboard view that updates in real time and is suitable for projecting on a screen.

Non-goals (MVP scope)
- Public user accounts, complex authentication, or cloud-hosted deployment.
- Monetization, multi-day tournaments, player-level profiles, or advanced anti-cheat beyond basic controls.

Roles and permissions
- Team player: joins a team, sets a team name (or selects an auto-generated one), and submits answers/wagers.
- Gamemaster: controls the game flow, creates/configures rounds and questions, reveals/marks answers, and manages scoring. Must be protected by a secret (PIN or token) or local-only access.
- Scoreboard viewer: read-only, minimal UI for projection. Protected so only authorized displays can access it.
- Admin (optional): can create questions, import/export question sets and manage persistent data.

Primary views

1) Team view (mobile-friendly)
- Join without a password using a short game code or link.
- Enter or edit team name (client enforces a simple length limit).
- See the current round's questions and available point options.
- Submit answer(s) for the round and assign distinct point values when required (no duplicates).
- Final round: submit a wager before the question is shown.
- Receive immediate visual confirmation of submission and current status (submitted, accepted, late).

2) Gamemaster view (protected)
- Create / configure rounds and their question count (1–3 questions per round by default).
- Define per-round allowed point values (e.g., [3,5,7]) and enforce unique assignment per question by each team.
- Start / end rounds, reveal correct answers, mark answers as correct/incorrect, and adjust scores.
- See live feed of incoming submissions, with team names and assigned point values.
- Resolve disputes manually (override correctness, edit scores) and set time limits per round.

3) Scoreboard view (read-only, minimal)
- Large, high-contrast text on a white background (configurable font size).
- Displays teams ordered by score with ties handled consistently.
- Auto-updates in real time when scores change.

Game format and rules
- Rounds: sequence of rounds; each round contains 1–3 questions (configurable per-round).
- Per-round point options: each round exposes N distinct point values (for example 3 values for 3 questions). Teams assign one point value to each question; duplicate assignments by the same team are rejected.
- Answer submission: teams submit their answers (and point assignments) within the round time window. Late submissions are either rejected or marked late (configurable behavior).
- Revealing and scoring: after submissions close, gamemaster reveals correct answers and marks each team correct/incorrect; score updates are applied.
- Final (wager) round: teams submit a wager (up to their available points or other configured limit) before the final question is displayed. Wagers must be locked before showing the question.

Real-time requirements
- Real-time updates for: team join/leave, submissions, score changes, and round state transitions.
- Target latency: under 500 ms for local network / LAN conditions.
- Transport: WebSockets (recommended) for bidirectional realtime messaging. Local hosting simplifies connectivity.

Security and access control
- Joining teams: no passwords required, join via short game code or local link.
- Gamemaster and scoreboard protection: require a short PIN or secret token (configurable) or only allow access from the host machine (127.0.0.1) for highest simplicity.
- No public authentication provider required for MVP.

Data shapes (JSON examples)

Team:
{
  "id": "team_abc123",
  "name": "The Quizzards",
  "score": 42,
  "connected": true
}

Question:
{
  "id": "q1",
  "text": "What year did X happen?",
  "choices": null,        // optional; null for open-answer
  "answer": "1984"       // stored server-side, not sent to teams until reveal
}

Round config:
{
  "id": "r1",
  "questions": ["q1","q2","q3"],
  "pointOptions": [3,5,7],
  "timeLimitSeconds": 45
}

Answer submission:
{
  "teamId": "team_abc123",
  "roundId": "r1",
  "answers": [
    {"questionId":"q1","response":"X","point":3},
    {"questionId":"q2","response":"Y","point":5},
    {"questionId":"q3","response":"Z","point":7}
  ],
  "timestamp":"2025-11-03T12:00:00Z"
}

Minimal real-time message/event list
- Client -> Server:
  - join_game {gameCode}
  - set_team_name {teamId, name}
  - submit_answers {submission}
  - submit_wager {teamId, roundId, wager}
- Server -> Client:
  - game_state_update {currentRound, timeRemaining, scoreboard}
  - submission_ack {accepted|late|rejected}
  - reveal_answers {roundId, correctAnswers}
  - score_update {teamScores}

Acceptance criteria (tests)
- Teams can join via a short game code and set a team name.
- Team submissions for a round are accepted and acknowledged while the round is open.
- Duplicate point assignment by a team is rejected with a clear message.
- Gamemaster can reveal answers and mark correctness; scoreboard updates reflect decisions instantly.
- Final round: wagers are accepted and locked before the final question is displayed.
- Scoreboard updates in under 500ms on LAN in normal conditions.

Edge cases and error handling
- Duplicate or empty team names: UI should warn and optionally append a suffix to keep names unique.
- Network disconnects: teams that reconnect get their previous teamId restored if reconnect occurs within a short window (e.g., 5 minutes).
- Late submissions: configurable policy (reject or mark late) and clear UI state.
- Ties: scoreboard shows tied teams next to each other; tiebreaker handled manually by gamemaster.

Assumptions
- The game will be run locally (single host) on a LAN for live events.
- The number of concurrent teams is modest (tens of teams rather than hundreds) for the MVP.
- Persistent storage is optional for MVP (in-memory state is acceptable), but we should support importing/exporting question sets.


Open questions (answered)
1. Gamemaster/scoreboard protection: short PIN, 6 digits.
2. Maximum concurrent teams: 25 teams.
3. Team model: treat a client as a single team (one phone per team).
4. Final round wager: limited to the team's current score.
5. Question types: support MCQ (auto-graded) and open-answer (manually graded).
6. Persistence: yes, persist games and scores between restarts.

Next steps / backlog
- Decide access-control approach (answer Q1).
- Finalize concurrency expectations (Q2) and persistence (Q6).
- Draft a minimal API and wireframe for the three views.
- Implement a small prototype using Node.js + Express + ws (WebSocket) or Python + FastAPI + WebSockets.
- Add import/export for question sets (CSV/JSON) and simple gamemaster controls.

Technical approach (chosen stack)

For the prototype and recommended MVP implementation we'll use TypeScript across the stack and the following technologies:
- Server: Node.js + Express written in TypeScript for HTTP endpoints and static hosting.
- Real-time: ws (WebSocket) for bidirectional, low-latency messaging between clients and server.
- Persistence: SQLite (lightweight, file-based) to persist question sets, games, teams, and scores.
- Client UI: React with TypeScript for Team, Gamemaster, and Scoreboard views.

Rationale
- TypeScript improves maintainability and reduces runtime errors by adding static types across server and client code.
- Node.js + Express (with TypeScript) is simple to scaffold, has excellent WebSocket library support, and is widely used for real-time apps.
- SQLite keeps deployment minimal (single file DB) and provides ACID guarantees for scoring.
- React + TypeScript gives fast iteration for the three distinct UI roles and safer refactors.

Tooling notes
- Provide a single `package.json` and use `ts-node`/`nodemon` for development, and `tsc` to build production JS.
- Frontend: create a React + TypeScript app (Vite or Create React App with TypeScript template recommended).

I'll produce a more detailed technical design and a minimal API next.

Question import format (JSON)

The system expects a rounds-first JSON structure. Each file is an object with a top-level `meta` block and a `rounds` array. Each round contains its own `questions` array and the `pointOptions` that teams will assign to questions during that round. Questions no longer include per-question `points` in the import; points are assigned by teams at submission time using the round's `pointOptions`.

Minimal import schema (informal, rounds-first):

{
  "meta": {
    "title": "Optional set title",
    "author": "Optional author",
    "createdAt": "ISO8601 timestamp",
    "defaultTimeLimit": 45
  },
  "rounds": [
    {
      "id": "r1",
      "pointOptions": [3,5,7],         // list of distinct point values teams choose from
      "timeLimitSeconds": 45,
      "questions": [
        {
          "id": "q1",
          "type": "mcq",               // "mcq" or "open"
          "text": "Which planet is known as the Red Planet?",
          "choices": ["Earth","Mars","Venus","Jupiter"],
          "correctChoiceIndex": 1,
          "explanation": "Mars is the Red Planet."
        },
        {
          "id": "q2",
          "type": "open",
          "text": "Name the author of 'Pride and Prejudice'.",
          "answer": "Jane Austen"
        }
      ]
    }
  ]
}

Notes on the import format
- IDs should be unique within a file. The server may reassign or namespace IDs on import.
- For MCQ questions with multiple correct answers, use "correctChoiceIndices": [0,2].
- The server will store the correct answers but only reveal them when the gamemaster triggers a reveal.
- Additional optional fields: tags (array), difficulty, roundHint, media (URL).

Example file: `questions_sample.json`

See the companion `questions_sample.json` file in the project root for a ready-to-upload example.

Rounds and game flow in import files

Import files may optionally include an explicit `rounds` array to define how questions are grouped into rounds, and each round's allowed point options. If `rounds` is not provided, import will create a default single-round game using all questions with default point options.

Round object example:

{
  "id": "r1",
  "questionIds": ["q1","q2","q3"],
  "pointOptions": [3,5,7],
  "timeLimitSeconds": 45
}

Rules for rounds and client behavior
- The gamemaster must explicitly open and close rounds from the Gamemaster view. Opening a round starts its timer and allows teams to submit answers.
- When no round is open (before the first round or between rounds), Team clients and the Scoreboard should show a configurable "waiting" screen (fun messaging or graphics) that indicates the game is paused and shows the next round index when available.
- Each round defines the set of possible point values (e.g., [3,5,7]). Teams must assign each point value to exactly one question in that round (no duplicates). The UI must enforce this.

Acceptance sign-off
- The gamemaster can: create rounds, start/stop rounds, reveal and mark answers, and correct scores.
- Teams can: join, submit answers/wagers, and see submission confirmations.
- Scoreboard can be projected and auto-updates in real time.

Document version: 1.0
