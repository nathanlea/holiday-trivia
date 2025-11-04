Technical approach - Trivia MVP

Overview
We will build a locally-hosted MVP using TypeScript on Node.js + Express, WebSockets via the "ws" library, SQLite for persistence, and a React + TypeScript front-end. The goals are low-latency real-time updates, easy local deployment, and a small, maintainable codebase.

Components
1) Server (Node.js + Express in TypeScript)
- Exposes HTTP endpoints for static assets (React app), question import, basic REST management (create game, list games, retrieve scoreboard), and an endpoint to request a gamemaster PIN.
- Hosts a WebSocket server for realtime messages: join, submit, ack, state updates, reveal, and score updates.

2) Web client (React)
- Team view: join, set name, submit answers/wagers, see submission status.
- Gamemaster view: manage rounds, see live submissions, mark correctness, reveal answers.
- Scoreboard view: minimal, read-only projection-friendly UI.

3) Persistence (SQLite)
- Tables: games, rounds, questions, teams, submissions, wagers, scores, events/log.
- A simple migration script to create schema if DB file missing.

Realtime message flows (summary)
- Client -> Server:
  - WS: join_game {gameCode}
  - WS: set_team_name {teamId, name}
  - WS: submit_answers {submission}
  - WS: submit_wager {teamId, roundId, wager}
  - HTTP POST: /import_questions (multipart/json)
- Server -> Client:
  - WS: game_state_update {currentRound, timeRemaining, scoreboard}
  - WS: submission_ack {accepted|late|rejected}
  - WS: reveal_answers {roundId, correctAnswers}
  - WS: score_update {teamScores}

Auth and access control
- Gamemaster and scoreboard pages require a 6-digit PIN (short-lived token stored server-side) to unlock privileged actions.
- For simplicity the PIN can be generated when creating a game and displayed to the host. The server maps PIN->gameId in a table with expiry.

API endpoints (examples)
- POST /api/games -> create game (returns gameCode and gamemaster PIN)
- POST /api/games/:id/import_questions -> upload JSON question file
- GET /api/games/:id/scoreboard -> returns current scores
- POST /api/games/:id/pin-login -> supply PIN to receive a session token/cookie

Persistence schema (high level)
- games(id, code, title, createdAt, pinHash)
- questions(id, gameId, type, text, choicesJson, correctJson, points, metaJson)
- teams(id, gameId, name, score, connected, createdAt)
- rounds(id, gameId, index, questionIdsJson, pointOptionsJson, timeLimitSec)
- submissions(id, teamId, roundId, answersJson, createdAt, accepted, late)
- wagers(id, teamId, roundId, amount, lockedAt)

Deployment notes
- Single-host deployment: run `node server.js` on a laptop connected to the venue network.
- Expose host IP + configured port; clients connect via browser to host IP:port. Scoreboard can be opened on a projector.

Next engineering tasks
1. Create project scaffold with `package.json`, `tsconfig.json`, ESLint/Prettier, and basic server + client folders in TypeScript.
2. Implement DB schema and migration script.
3. Implement import endpoint and sample import runner loading `questions_sample.json`.
4. Implement WebSocket server with core message handlers (join, submit, ack, broadcast state).
5. Implement minimal React pages: Team join/submission, Gamemaster control, Scoreboard.
6. Add tests (unit for core scoring logic, integration smoke test for WS flows).

Notes on scalability
- This design is tailored for up to ~25 concurrent teams on a LAN. If you need to scale to hundreds, we would move from SQLite to Postgres and add horizontal scaling for WebSocket (Redis pub/sub or a WebSocket broker).
