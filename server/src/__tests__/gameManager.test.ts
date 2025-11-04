import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import GameManager from '../gameManager';
import { initializeDatabase, sequelize, Round, Question, Submission, Team } from '../db';

async function getRoundByMode(gameId: string, mode: string) {
    return Round.findOne({ where: { gameId, mode }, order: [['roundIndex', 'ASC']] });
}

describe('GameManager scoring', () => {
    const manager = new GameManager();

    beforeAll(async () => {
        await initializeDatabase();
    });

    beforeEach(async () => {
        await sequelize.truncate({ cascade: true });
    });

    afterAll(async () => {
        await sequelize.close();
    });

    it('updates team score after grading a standard round', async () => {
        const game = await manager.createGame('Standard Test', '123456');
        await manager.importGameData(game.code, '123456', {
            rounds: [
                {
                    label: 'Round 1',
                    pointOptions: [10],
                    timeLimitSeconds: 60,
                    questions: [
                        {
                            type: 'open',
                            text: 'Who wrote Hamlet?',
                            answer: 'Shakespeare',
                        },
                    ],
                },
            ],
        });

        const team = await manager.joinTeam(game.code, 'Alpha Team');
        const standardRound = await getRoundByMode(game.id, 'standard');
        if (!standardRound) {
            throw new Error('Standard round not found');
        }

        await manager.openRound(game.code, '123456', standardRound.id);

        const question = await Question.findOne({ where: { roundId: standardRound.id } });
        if (!question) {
            throw new Error('Question not found');
        }

        await manager.submitAnswers(game.code, team.teamId, team.teamToken, standardRound.id, [
            {
                questionId: question.id,
                response: 'Shakespeare',
                pointValue: 10,
            },
        ]);

        const submission = await Submission.findOne({ where: { roundId: standardRound.id, teamId: team.teamId } });
        if (!submission) {
            throw new Error('Submission not found');
        }

        await manager.gradeSubmission(game.code, '123456', submission.id, [
            { questionId: question.id, status: 'correct' },
        ]);

        const updatedTeam = await Team.findByPk(team.teamId);
        expect(updatedTeam?.score).toBe(10);
    });

    it('applies wager penalties when final answers are incorrect', async () => {
        const game = await manager.createGame('Final Test', '123456');
        await manager.importGameData(game.code, '123456', {
            rounds: [
                {
                    label: 'Round 1',
                    pointOptions: [10],
                    timeLimitSeconds: 45,
                    questions: [
                        {
                            type: 'open',
                            text: 'First standard question?',
                            answer: 'Answer',
                        },
                    ],
                },
                {
                    label: 'Final Round',
                    pointOptions: [0],
                    timeLimitSeconds: 60,
                    isFinal: true,
                    questions: [
                        {
                            type: 'open',
                            text: 'Final question text?',
                            answer: 'Correct',
                        },
                    ],
                },
            ],
        });

        const team = await manager.joinTeam(game.code, 'Bravo Team');

        const standardRound = await getRoundByMode(game.id, 'standard');
        if (!standardRound) {
            throw new Error('Standard round not found');
        }

        await manager.openRound(game.code, '123456', standardRound.id);
        const standardQuestion = await Question.findOne({ where: { roundId: standardRound.id } });
        if (!standardQuestion) {
            throw new Error('Standard question not found');
        }

        await manager.submitAnswers(game.code, team.teamId, team.teamToken, standardRound.id, [
            {
                questionId: standardQuestion.id,
                response: 'Answer',
                pointValue: 10,
            },
        ]);

        let submission = await Submission.findOne({ where: { roundId: standardRound.id, teamId: team.teamId } });
        if (!submission) {
            throw new Error('Standard submission not found');
        }
        await manager.gradeSubmission(game.code, '123456', submission.id, [
            { questionId: standardQuestion.id, status: 'correct' },
        ]);

        await manager.closeRound(game.code, '123456', standardRound.id);

        const wagerRound = await getRoundByMode(game.id, 'wager');
        const finalRound = await getRoundByMode(game.id, 'final');
        if (!wagerRound || !finalRound) {
            throw new Error('Final or wager round missing');
        }

        await manager.openRound(game.code, '123456', wagerRound.id);
        await manager.submitWager(game.code, team.teamId, team.teamToken, wagerRound.id, 5);
        await manager.closeRound(game.code, '123456', wagerRound.id);

        await manager.openRound(game.code, '123456', finalRound.id);

        const finalQuestion = await Question.findOne({ where: { roundId: finalRound.id } });
        if (!finalQuestion) {
            throw new Error('Final question not found');
        }

        await manager.submitAnswers(game.code, team.teamId, team.teamToken, finalRound.id, [
            {
                questionId: finalQuestion.id,
                response: 'Wrong',
                pointValue: null,
            },
        ]);

        submission = await Submission.findOne({ where: { roundId: finalRound.id, teamId: team.teamId } });
        if (!submission) {
            throw new Error('Final submission not found');
        }

        await manager.gradeSubmission(game.code, '123456', submission.id, [
            { questionId: finalQuestion.id, status: 'incorrect' },
        ]);

        const updatedTeam = await Team.findByPk(team.teamId);
        expect(updatedTeam?.score).toBe(5);
    });

    it('includes wagers in gamemaster state before final round submissions', async () => {
        const game = await manager.createGame('Wager State Test', '123456');
        await manager.importGameData(game.code, '123456', {
            rounds: [
                {
                    label: 'Round 1',
                    pointOptions: [10],
                    timeLimitSeconds: 45,
                    questions: [
                        {
                            type: 'open',
                            text: 'Standard question?',
                            answer: 'Answer',
                        },
                    ],
                },
                {
                    label: 'Final Round',
                    pointOptions: [0],
                    timeLimitSeconds: 60,
                    isFinal: true,
                    questions: [
                        {
                            type: 'open',
                            text: 'Final question?',
                            answer: 'Answer',
                        },
                    ],
                },
            ],
        });

        const team1 = await manager.joinTeam(game.code, 'Team Alpha');
        const team2 = await manager.joinTeam(game.code, 'Team Beta');

        // First, give teams some points
        const standardRound = await getRoundByMode(game.id, 'standard');
        if (!standardRound) {
            throw new Error('Standard round not found');
        }

        await manager.openRound(game.code, '123456', standardRound.id);
        const standardQuestion = await Question.findOne({ where: { roundId: standardRound.id } });
        if (!standardQuestion) {
            throw new Error('Standard question not found');
        }

        // Submit and grade for both teams
        for (const team of [team1, team2]) {
            await manager.submitAnswers(game.code, team.teamId, team.teamToken, standardRound.id, [
                {
                    questionId: standardQuestion.id,
                    response: 'Answer',
                    pointValue: 10,
                },
            ]);
            const submission = await Submission.findOne({ where: { roundId: standardRound.id, teamId: team.teamId } });
            if (submission) {
                await manager.gradeSubmission(game.code, '123456', submission.id, [
                    { questionId: standardQuestion.id, status: 'correct' },
                ]);
            }
        }

        await manager.closeRound(game.code, '123456', standardRound.id);

        // Now test wager round - get it fresh after closing standard
        const wagerRound = await getRoundByMode(game.id, 'wager');
        const finalRound = await getRoundByMode(game.id, 'final');
        if (!wagerRound || !finalRound) {
            throw new Error('Wager or final round not found');
        }

        console.log('Standard round ID:', standardRound.id);
        console.log('Wager round ID:', wagerRound.id);
        console.log('Final round ID:', finalRound.id);

        await manager.openRound(game.code, '123456', wagerRound.id);

        // Submit wagers for both teams
        await manager.submitWager(game.code, team1.teamId, team1.teamToken, wagerRound.id, 10);
        await manager.submitWager(game.code, team2.teamId, team2.teamToken, wagerRound.id, 5);

        // Get gamemaster state - this simulates what the websocket sends to the GM
        const gmState = await (manager as any).buildGamemasterState(game.id);

        // Debug: Log the round IDs
        console.log('Standard round ID:', standardRound.id);
        console.log('Wager round ID:', wagerRound.id);
        console.log('Final round ID:', finalRound.id);
        console.log('Wagers in gmState:', JSON.stringify(gmState.wagers, null, 2));

        // Verify wagers are in the state
        expect(gmState.wagers).toBeDefined();
        expect(gmState.wagers).toHaveLength(2);
        
        // IMPORTANT: Wagers are stored with the FINAL round ID, not the wager round ID!
        // This is because wagers apply to the final round they're linked to.
        const wager1 = gmState.wagers.find((w: any) => w.teamId === team1.teamId);
        const wager2 = gmState.wagers.find((w: any) => w.teamId === team2.teamId);
        
        expect(wager1).toBeDefined();
        expect(wager1.amount).toBe(10);
        expect(wager1.roundId).toBe(finalRound.id); // Linked final round, NOT wager round!
        
        expect(wager2).toBeDefined();
        expect(wager2.amount).toBe(5);
        expect(wager2.roundId).toBe(finalRound.id); // Linked final round, NOT wager round!

        // Verify game.currentRoundId is set
        expect(gmState.game.currentRoundId).toBe(wagerRound.id);

        // Verify submissions are still empty at this point (no final round submissions yet)
        expect(gmState.submissions).toHaveLength(2); // Only standard round submissions
        expect(gmState.submissions.every((s: any) => s.roundId === standardRound.id)).toBe(true);
    });
});
