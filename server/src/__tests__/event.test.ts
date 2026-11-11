import http from 'http';
import { once } from 'events';
import fs from 'fs';
import path from 'path';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'net';
import type { HelloPayload, ServerToClientMessage } from '../../../shared/types';
import { createApp } from '../app';
import { Game, initializeDatabase, Question, Round, sequelize, Submission, Team } from '../db';
import GameManager from '../gameManager';
import { setupWebsocket } from '../ws';

const secret = '123456';
const questions = {
    rounds: [
        { label: 'Round 1', pointOptions: [10], timeLimitSeconds: 60, questions: [
            { type: 'numeric', text: 'How many?', explanation: 'Secret explanation', numericConfig: {
                correctAnswer: 0, ranges: [{ maxPercentOff: 0, pointsPercent: 100 }],
            } },
        ] },
        { label: 'Final', pointOptions: [0], isFinal: true, timeLimitSeconds: 60, questions: [
            { type: 'open', text: 'Secret final question', answer: 'Secret answer' },
        ] },
    ],
};

describe('Public event workflow', () => {
    const manager = new GameManager();
    const server = http.createServer(createApp(manager));
    const wss = setupWebsocket(server, manager);
    const sockets = new Set<WebSocket>();
    let base: string;

    beforeAll(async () => {
        await initializeDatabase();
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    beforeEach(async () => {
        for (const socket of sockets) socket.terminate();
        sockets.clear();
        await sequelize.truncate({ cascade: true });
    });
    afterAll(async () => {
        for (const socket of sockets) socket.terminate();
        for (const socket of wss.clients) socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        await sequelize.close();
    });

    function api(path: string, body?: unknown, hostSecret?: string) {
        return fetch(`${base}/api${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { 'Content-Type': 'application/json', ...(hostSecret ? { 'x-trivia-admin': hostSecret } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    }

    function connect(payload: HelloPayload): Promise<ServerToClientMessage> {
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(`${base.replace('http:', 'ws:')}/ws`, {
                origin: 'http://localhost:8000',
            });
            sockets.add(socket);
            const timeout = setTimeout(() => reject(new Error('WebSocket state timed out')), 3000);
            socket.on('error', reject);
            socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', payload })));
            socket.on('message', (raw) => {
                const message = JSON.parse(raw.toString()) as ServerToClientMessage;
                if (message.type === 'game_state' || message.type === 'error') {
                    clearTimeout(timeout);
                    resolve(message);
                }
            });
        });
    }

    async function preparedGame() {
        const game = await manager.createGame('Lunch trivia', secret);
        await manager.importGameData(game.code, secret, questions);
        const round = await Round.findOne({ where: { gameId: game.id, mode: 'standard' } });
        const question = await Question.findOne({ where: { roundId: round!.id } });
        return { game, round: round!, question: question! };
    }

    it('requires the single host secret to create games and change joining', async () => {
        expect((await api('/games', { title: 'No secret', pin: '123456' })).status).toBe(401);
        expect((await api('/games', { title: 'Wrong secret' }, 'wrong')).status).toBe(401);
        const response = await api('/games', { title: 'Holiday trivia' }, secret);
        expect(response.status).toBe(201);
        const { game } = await response.json();
        expect((await api(`/games/${game.code}/joining`, { open: false })).status).toBe(401);
        expect((await api(`/games/${game.code}/joining`, { open: false }, secret)).status).toBe(204);
    });

    it('publishes exactly one open game and prevents joining closed games', async () => {
        expect(await (await api('/games/open')).json()).toEqual({ game: null });
        const first = await manager.createGame('First', secret);
        const second = await manager.createGame('Second', secret);
        expect((await (await api('/games/open')).json()).game.code).toBe(second.code);
        expect((await api(`/games/${first.code}/teams`, { name: 'Late team' })).status).toBe(409);
        await manager.setJoiningOpen(first.code, secret, true);
        expect((await Game.findAll({ where: { joiningOpen: true } })).map((game) => game.code)).toEqual([first.code]);
        const joined = await api(`/games/${first.code}/teams`, { name: 'Lunch bunch' });
        expect(joined.status).toBe(201);
        expect((await joined.json()).game.code).toBe(first.code);
        await manager.setJoiningOpen(first.code, secret, false);
        expect((await api(`/games/${first.code}/teams`, { name: 'Too late' })).status).toBe(409);
    });

    it('allows a PIN-free scoreboard but rejects unprotected host connections', async () => {
        const { game } = await preparedGame();
        const scoreboard = await connect({ role: 'scoreboard', gameCode: game.code });
        expect(scoreboard.type).toBe('game_state');
        const rejected = await connect({ role: 'gamemaster', gameCode: game.code });
        expect(rejected).toMatchObject({ type: 'error', message: 'Invalid host secret' });
        const host = await connect({ role: 'gamemaster', gameCode: game.code, adminSecret: secret });
        expect(host.type).toBe('game_state');
    });

    it('does not send future questions or open-round answer keys to public views', async () => {
        const { game, round } = await preparedGame();
        const team = await manager.joinTeam(game.code, 'Team');
        await manager.openRound(game.code, secret, round.id);
        for (const payload of [
            { role: 'team' as const, gameCode: game.code, teamId: team.teamId, teamToken: team.teamToken },
            { role: 'scoreboard' as const, gameCode: game.code },
        ]) {
            const message = await connect(payload);
            expect(message.type).toBe('game_state');
            if (message.type !== 'game_state') throw new Error('Expected state');
            expect(JSON.stringify(message)).not.toContain('Secret');
            const current = message.payload.rounds.find((entry) => entry.id === round.id);
            expect(current?.questions[0].numericConfig).toBeNull();
            expect(message.payload.rounds.find((entry) => entry.mode === 'final')?.questions).toEqual([]);
        }
    });

    it('enforces deadlines for answers and wagers on the server', async () => {
        const { game, round, question } = await preparedGame();
        const team = await manager.joinTeam(game.code, 'Team');
        await manager.openRound(game.code, secret, round.id);
        await round.update({ openedAt: new Date(Date.now() - 120_000).toISOString() });
        const response = await api(`/games/${game.code}/answers`, {
            ...team, roundId: round.id, answers: [{ questionId: question.id, response: '0', pointValue: 10 }],
        });
        expect(response.status).toBe(409);
        await manager.closeRound(game.code, secret, round.id);
        const wager = await Round.findOne({ where: { gameId: game.id, mode: 'wager' } });
        await manager.openRound(game.code, secret, wager!.id);
        await wager!.update({ openedAt: new Date(Date.now() - 120_000).toISOString() });
        await expect(manager.submitWager(game.code, team.teamId, team.teamToken, wager!.id, 0)).rejects.toThrow('Time is up');
    });

    it('scores zero numeric answers and prevents repeat submissions changing scores', async () => {
        const { game, round, question } = await preparedGame();
        const team = await manager.joinTeam(game.code, 'Team');
        await manager.openRound(game.code, secret, round.id);
        const answers = [{ questionId: question.id, response: '0', pointValue: 10 }];
        await manager.submitAnswers(game.code, team.teamId, team.teamToken, round.id, answers);
        expect((await Team.findByPk(team.teamId))?.score).toBe(10);
        await expect(manager.submitAnswers(game.code, team.teamId, team.teamToken, round.id, answers)).rejects.toThrow('already been received');
        const submission = await Submission.findOne({ where: { teamId: team.teamId } });
        await manager.gradeSubmission(game.code, secret, submission!.id, [{ questionId: question.id, status: 'correct' }]);
        await manager.gradeSubmission(game.code, secret, submission!.id, [{ questionId: question.id, status: 'correct' }]);
        expect((await Team.findByPk(team.teamId))?.score).toBe(10);
    });

    it('keeps zero-duration rounds untimed', async () => {
        const { game, round, question } = await preparedGame();
        const team = await manager.joinTeam(game.code, 'Team');
        await manager.openRound(game.code, secret, round.id);
        await round.update({ timeLimitSeconds: 0, openedAt: new Date(Date.now() - 120_000).toISOString() });
        await manager.submitAnswers(game.code, team.teamId, team.teamToken, round.id, [
            { questionId: question.id, response: '0', pointValue: 10 },
        ]);
        expect((await Team.findByPk(team.teamId))?.score).toBe(10);
    });

    it('accepts 25 simultaneous team submissions without losing scores', async () => {
        const { game, round, question } = await preparedGame();
        const teams = await Promise.all(Array.from({ length: 25 }, (_, index) => manager.joinTeam(game.code, `Team ${index}`)));
        await manager.openRound(game.code, secret, round.id);
        await Promise.all(teams.map((team) => manager.submitAnswers(
            game.code, team.teamId, team.teamToken, round.id,
            [{ questionId: question.id, response: '0', pointValue: 10 }],
        )));
        expect(await Submission.count()).toBe(25);
        expect((await manager.getScoreboard(game.code)).every((entry) => entry.score === 10)).toBe(true);
    });

    it('serializes simultaneous score adjustments for the same team', async () => {
        const { game } = await preparedGame();
        const team = await manager.joinTeam(game.code, 'Team');
        await Promise.all(Array.from({ length: 10 }, () => manager.adjustTeamScore(game.code, secret, team.teamId, 1)));
        expect((await Team.findByPk(team.teamId))?.score).toBe(10);
    });

    it('preserves auto-scored zero wager penalties when saving unchanged grades', async () => {
        const game = await manager.createGame('Numeric final', secret);
        await manager.importGameData(game.code, secret, {
            rounds: [{ label: 'Final', pointOptions: [0], isFinal: true, questions: [{
                type: 'numeric', text: 'Estimate 100', numericConfig: {
                    correctAnswer: 100,
                    ranges: [{ maxPercentOff: 0, pointsPercent: 100 }],
                    wagerLossThresholds: [{ maxPercentOff: 20, wagerLossPercent: 0 }],
                },
            }] }],
        });
        const team = await manager.joinTeam(game.code, 'Team');
        await manager.adjustTeamScore(game.code, secret, team.teamId, 10);
        const wager = await Round.findOne({ where: { gameId: game.id, mode: 'wager' } });
        const final = await Round.findOne({ where: { gameId: game.id, mode: 'final' } });
        const question = await Question.findOne({ where: { roundId: final!.id } });
        await manager.openRound(game.code, secret, wager!.id);
        await manager.submitWager(game.code, team.teamId, team.teamToken, wager!.id, 5);
        await manager.closeRound(game.code, secret, wager!.id);
        await manager.openRound(game.code, secret, final!.id);
        await manager.submitAnswers(game.code, team.teamId, team.teamToken, final!.id, [
            { questionId: question!.id, response: '110', pointValue: null },
        ]);
        const submission = await Submission.findOne({ where: { teamId: team.teamId } });
        await manager.gradeSubmission(game.code, secret, submission!.id, [
            { questionId: question!.id, status: 'incorrect' },
        ]);
        expect((await Team.findByPk(team.teamId))?.score).toBe(10);
    });

    it.each(['questions_sample.json', 'questiosn.json'])('keeps the existing %s import format', async (filename) => {
        const game = await manager.createGame('Import check', secret);
        const payload: unknown = JSON.parse(fs.readFileSync(path.resolve('..', filename), 'utf8'));
        await manager.importGameData(game.code, secret, payload);
        expect(await Round.count({ where: { gameId: game.id } })).toBeGreaterThan(0);
    });

    it('returns clear JSON for malformed input and rejects unknown origins', async () => {
        const bad = await fetch(`${base}/api/games`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
        });
        expect(bad.status).toBe(400);
        expect(await bad.json()).toEqual({ error: 'Request body must be valid JSON' });
        expect((await fetch(`${base}/api/health`, { headers: { Origin: 'https://other.example' } })).status).toBe(403);
        const healthy = await api('/health');
        expect(healthy.status).toBe(200);
        expect(healthy.headers.get('cache-control')).toBe('no-store');
    });
});
