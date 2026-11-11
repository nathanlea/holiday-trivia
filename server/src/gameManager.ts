import { randomUUID } from 'crypto';
import { Op, Transaction, UniqueConstraintError } from 'sequelize';
import { WebSocket } from 'ws';
import {
    Game,
    Question,
    Round,
    Submission,
    SubmissionResult,
    Team,
    Wager,
    writeTransaction,
} from './db';
import { HttpError, assert } from './errors';
import { generateGameCode, generateToken, normalizeName, nowUtc } from './utils';
import { TEAM_TOKEN_BYTES } from './config';
import { assertAdminSecret } from './auth';
import {
    ClientRole,
    GameSummary,
    GamemasterGameState,
    RoundQuestionView,
    RoundStateView,
    RoundStatus,
    ScoreboardGameState,
    ServerGameState,
    ServerToClientMessage,
    SubmissionAckMessage,
    SubmissionView,
    TeamGameState,
    TeamScore,
    TeamSubmissionSummary,
    TeamWagerSummary,
    WagerAckMessage,
} from '../../shared/types';

export interface ConnectedClient {
    id: string;
    socket: WebSocket;
    role: ClientRole;
    gameId: string;
    teamId?: string;
}

interface ImportMeta {
    title?: string;
    author?: string;
    createdAt?: string;
    defaultTimeLimit?: number;
}

interface ImportQuestion {
    id?: string;
    type: 'mcq' | 'open' | 'numeric';
    text: string;
    choices?: string[];
    correctChoiceIndex?: number;
    correctChoiceIndices?: number[];
    answer?: string | number;
    explanation?: string;
    numericConfig?: {
        correctAnswer: number;
        ranges: Array<{
            maxPercentOff: number;
            /** Points percentage (can exceed 100 for bonus, e.g., 125 for exact answer) */
            pointsPercent: number;
        }>;
        /** Optional wager loss thresholds for final round numeric questions */
        wagerLossThresholds?: Array<{
            maxPercentOff: number;
            /** Percentage of wager points to lose (0 = keep all, 100 = lose all) */
            wagerLossPercent: number;
        }>;
    };
}

interface ImportRound {
    id?: string;
    label?: string;
    pointOptions: number[];
    timeLimitSeconds?: number;
    isFinal?: boolean;
    questions: ImportQuestion[];
}

interface ImportPayload {
    meta?: ImportMeta;
    rounds: ImportRound[];
}

interface AnswerPayload {
    questionId: string;
    response: string;
    pointValue: number | null;
}

interface GradePayload {
    questionId: string;
    status: 'pending' | 'correct' | 'incorrect';
    awardedPoints?: number;
}

export class GameManager {
    private clientsByGame = new Map<string, Map<string, ConnectedClient>>();

    async createGame(title: string, pin: string, code?: string): Promise<GameSummary> {
        assertAdminSecret(pin);
        const normalizedTitle = title.trim();
        assert(normalizedTitle.length > 0 && normalizedTitle.length <= 120, 400, 'Title must be 1 to 120 characters');
        assert(!code || /^[A-Z0-9]{3,6}$/i.test(code), 400, 'Game code must be 3 to 6 letters or numbers');

        if (code) {
            const existing = await Game.findOne({ where: { code: code.toUpperCase() } });
            assert(!existing, 409, 'Game code already exists');
        }

        let gameCode = code?.toUpperCase() ?? generateGameCode();
        while (await Game.findOne({ where: { code: gameCode } })) {
            gameCode = generateGameCode();
        }

        const id = randomUUID();
        const createdAt = nowUtc();
        await writeTransaction(async (transaction) => {
            await Game.update({ joiningOpen: false }, { where: {}, transaction });
            await Game.create({
                id,
                code: gameCode,
                title: normalizedTitle,
                joiningOpen: true,
                createdAt,
                currentRoundId: null,
            }, { transaction });
        });
        for (const gameId of this.clientsByGame.keys()) {
            await this.broadcastGameState(gameId);
        }
        return {
            id,
            code: gameCode,
            title: normalizedTitle,
            currentRoundId: null,
            createdAt,
            joiningOpen: true,
        };
    }

    async getOpenGame(): Promise<GameSummary | null> {
        const game = await Game.findOne({ where: { joiningOpen: true } });
        return game ? this.buildGameSummary(game) : null;
    }

    async setJoiningOpen(gameCode: string, secret: string, open: boolean): Promise<void> {
        assertAdminSecret(secret);
        const game = await this.getGameByCode(gameCode);
        await writeTransaction(async (transaction) => {
            if (open) {
                await Game.update({ joiningOpen: false }, { where: {}, transaction });
            }
            await game.update({ joiningOpen: open }, { transaction });
        });
        for (const id of this.clientsByGame.keys()) {
            await this.broadcastGameState(id);
        }
    }

    async importGameData(gameCode: string, pin: string, payload: unknown): Promise<void> {
        const game = await this.getGameByCode(gameCode);
        assertAdminSecret(pin);

        const parsed = this.parseImportPayload(payload);

        await writeTransaction(async (transaction: Transaction) => {
            await this.clearGameContent(game.id, transaction);

            let roundPosition = 0;

            for (let index = 0; index < parsed.rounds.length; index += 1) {
                const round = parsed.rounds[index];
                const baseLabel = round.label?.trim() || `Round ${index + 1}`;
                const pointOptions = JSON.stringify(round.pointOptions);
                const timeLimit = round.timeLimitSeconds ?? parsed.meta?.defaultTimeLimit ?? null;

                if (round.isFinal) {
                    const finalRoundId = randomUUID();
                    const wagerRoundId = randomUUID();
                    const wagerLabel = `${baseLabel} Wager`;

                    await Round.create(
                        {
                            id: wagerRoundId,
                            gameId: game.id,
                            roundIndex: roundPosition,
                            label: wagerLabel,
                            pointOptions: JSON.stringify([]),
                            timeLimitSeconds: timeLimit,
                            isFinal: false,
                            status: 'pending',
                            openedAt: null,
                            closedAt: null,
                            mode: 'wager',
                            linkedRoundId: finalRoundId,
                        },
                        { transaction }
                    );

                    roundPosition += 1;

                    await Round.create(
                        {
                            id: finalRoundId,
                            gameId: game.id,
                            roundIndex: roundPosition,
                            label: baseLabel,
                            pointOptions,
                            timeLimitSeconds: timeLimit,
                            isFinal: true,
                            status: 'pending',
                            openedAt: null,
                            closedAt: null,
                            mode: 'final',
                            linkedRoundId: null,
                        },
                        { transaction }
                    );

                    for (let qIndex = 0; qIndex < round.questions.length; qIndex += 1) {
                        const question = round.questions[qIndex];
                        const questionId = question.id?.toString() || randomUUID();
                        const storedQuestionId = `${finalRoundId}-${questionId}`;
                        const choicesJson = question.choices ? JSON.stringify(question.choices) : null;
                        const correctJson = this.encodeCorrectAnswer(question);
                        const numericConfigJson = question.numericConfig ? JSON.stringify(question.numericConfig) : null;

                        await Question.create(
                            {
                                id: storedQuestionId,
                                roundId: finalRoundId,
                                questionIndex: qIndex,
                                type: question.type,
                                text: question.text,
                                choicesJson,
                                correctJson,
                                explanation: question.explanation ?? null,
                                numericConfigJson,
                            },
                            { transaction }
                        );
                    }

                    roundPosition += 1;
                } else {
                    const roundId = randomUUID();

                    await Round.create(
                        {
                            id: roundId,
                            gameId: game.id,
                            roundIndex: roundPosition,
                            label: baseLabel,
                            pointOptions,
                            timeLimitSeconds: timeLimit,
                            isFinal: false,
                            status: 'pending',
                            openedAt: null,
                            closedAt: null,
                            mode: 'standard',
                            linkedRoundId: null,
                        },
                        { transaction }
                    );

                    for (let qIndex = 0; qIndex < round.questions.length; qIndex += 1) {
                        const question = round.questions[qIndex];
                        const questionId = question.id?.toString() || randomUUID();
                        const storedQuestionId = `${roundId}-${questionId}`;
                        const choicesJson = question.choices ? JSON.stringify(question.choices) : null;
                        const correctJson = this.encodeCorrectAnswer(question);
                        const numericConfigJson = question.numericConfig ? JSON.stringify(question.numericConfig) : null;

                        await Question.create(
                            {
                                id: storedQuestionId,
                                roundId,
                                questionIndex: qIndex,
                                type: question.type,
                                text: question.text,
                                choicesJson,
                                correctJson,
                                explanation: question.explanation ?? null,
                                numericConfigJson,
                            },
                            { transaction }
                        );
                    }

                    roundPosition += 1;
                }
            }

            await game.update({ currentRoundId: null }, { transaction });
        });

        await this.broadcastGameState(game.id);
    }

    async joinTeam(gameCode: string, name: string) {
        const game = await this.getGameByCode(gameCode);
        assert(game.joiningOpen, 409, 'Joining is closed. Please ask the host to open joining.');
        const normalizedName = normalizeName(name);
        assert(normalizedName.length >= 2 && normalizedName.length <= 40, 400, 'Team name must be 2 to 40 characters');

        const id = randomUUID();
        const joinToken = generateToken(TEAM_TOKEN_BYTES);
        const createdAt = nowUtc();

        try {
            await writeTransaction(async (transaction) => {
                await game.reload({ transaction });
                assert(game.joiningOpen, 409, 'Joining is closed. Please ask the host to open joining.');
                await Team.create({
                    id,
                    gameId: game.id,
                    name: normalizedName,
                    joinToken,
                    score: 0,
                    createdAt,
                }, { transaction });
            });
        } catch (error) {
            if (error instanceof UniqueConstraintError) {
                throw new HttpError(409, 'That team name is already taken');
            }
            throw error;
        }

        await this.broadcastGameState(game.id);

        return {
            teamId: id,
            teamToken: joinToken,
            name: normalizedName,
            score: 0,
            game: this.buildGameSummary(game),
        };
    }

    async removeTeam(gameCode: string, pin: string, teamId: string): Promise<void> {
        const game = await this.getGameByCode(gameCode);
        assertAdminSecret(pin);
        const team = await this.getTeamById(teamId);
        assert(team.gameId === game.id, 400, 'Team does not belong to this game');

        await writeTransaction(async (transaction: Transaction) => {
            const submissions = await Submission.findAll({
                where: { teamId: team.id },
                attributes: ['id'],
                transaction,
            });
            const submissionIds = submissions.map((submission) => submission.id);
            if (submissionIds.length > 0) {
                await SubmissionResult.destroy({ where: { submissionId: { [Op.in]: submissionIds } }, transaction });
                await Submission.destroy({ where: { id: { [Op.in]: submissionIds } }, transaction });
            }

            await Wager.destroy({ where: { teamId: team.id }, transaction });
            await Team.destroy({ where: { id: team.id }, transaction });
        });

        this.disconnectTeamClients(game.id, team.id, 'This team has been removed by the gamemaster.');
        await this.broadcastGameState(game.id);
    }

    async adjustTeamScore(
        gameCode: string,
        pin: string,
        teamId: string,
        delta: number,
        _note?: string,
    ): Promise<{ score: number; delta: number; updatedAt: string }> {
        const game = await this.getGameByCode(gameCode);
        assertAdminSecret(pin);
        assert(Number.isFinite(delta), 400, 'Adjustment amount must be a number');
        const adjustment = Math.trunc(delta);
        assert(adjustment !== 0, 400, 'Adjustment must be non-zero');

        const team = await this.getTeamById(teamId);
        assert(team.gameId === game.id, 400, 'Team does not belong to this game');

        const nextScore = await writeTransaction(async (transaction) => {
            await team.reload({ transaction });
            const score = Math.max(team.score + adjustment, 0);
            await team.update({ score }, { transaction });
            return score;
        });

        await this.broadcastGameState(game.id);

        return {
            score: nextScore,
            delta: adjustment,
            updatedAt: nowUtc(),
        };
    }

    async submitWager(gameCode: string, teamId: string, teamToken: string, roundId: string, amount: number): Promise<void> {
        const game = await this.getGameByCode(gameCode);
        const team = await this.getTeamById(teamId);
        assert(team.gameId === game.id, 400, 'Team does not belong to this game');
        assert(team.joinToken === teamToken, 401, 'Invalid team token');

        const round = await this.getRoundById(roundId);
        assert(round.gameId === game.id, 400, 'Round does not belong to this game');

        let targetRound = round;

        if (round.mode === 'wager') {
            assert(round.status === 'open', 400, 'Wager round must be open to submit a wager');
            this.assertWithinDeadline(round);
            assert(round.linkedRoundId, 500, 'Wager round is missing a linked final round');
            const linkedRound = await this.getRoundById(round.linkedRoundId);
            assert(linkedRound.gameId === game.id, 400, 'Linked final round does not belong to this game');
            targetRound = linkedRound;
        } else {
            assert(round.isFinal, 400, 'Wagers are only allowed on the final round');
            const wagerRound = await Round.findOne({ where: { gameId: game.id, mode: 'wager', linkedRoundId: round.id } });
            assert(wagerRound?.status === 'open', 400, 'Wagers are only accepted while the wager round is open');
            this.assertWithinDeadline(wagerRound);
        }
        assert(Number.isInteger(amount) && amount >= 0, 400, 'Wager must be a non-negative whole number');
        assert(amount <= team.score, 400, 'Wager cannot exceed current team score');

        const lockedAt = nowUtc();

        await writeTransaction(async (transaction) => {
            const acceptingRound = round.mode === 'wager' ? round : await Round.findOne({
                where: { gameId: game.id, mode: 'wager', linkedRoundId: targetRound.id }, transaction,
            });
            assert(acceptingRound, 400, 'Wager round not found');
            await acceptingRound.reload({ transaction });
            assert(acceptingRound.status === 'open', 409, 'Wager round is closed');
            this.assertWithinDeadline(acceptingRound);
            const existing = await Wager.findOne({ where: { teamId: team.id, roundId: targetRound.id }, transaction });
            if (existing) {
                await existing.update({ amount, lockedAt }, { transaction });
            } else {
                await Wager.create({ id: randomUUID(), teamId: team.id, roundId: targetRound.id, amount, lockedAt }, { transaction });
            }
        });

        await this.broadcastGameState(game.id);

        this.sendWagerAck(game.id, team.id, {
            roundId: targetRound.id,
            status: 'accepted',
            message: 'Wager locked in',
        });
    }

    async submitAnswers(
        gameCode: string,
        teamId: string,
        teamToken: string,
        roundId: string,
        answers: AnswerPayload[],
    ): Promise<void> {
        const game = await this.getGameByCode(gameCode);
        const team = await this.getTeamById(teamId);
        assert(team.gameId === game.id, 400, 'Team does not belong to this game');
        assert(team.joinToken === teamToken, 401, 'Invalid team token');

        const round = await this.getRoundById(roundId);
        assert(round.gameId === game.id, 400, 'Round does not belong to this game');
        assert(round.status === 'open', 400, 'Round is not accepting submissions');
        this.assertWithinDeadline(round);
        assert(round.mode !== 'wager', 400, 'This round only accepts wagers');

        const questions = await this.getQuestionsForRound(round.id);
        assert(questions.length === answers.length, 400, 'All questions must be answered');

        const pointOptions = JSON.parse(round.pointOptions) as number[];
        const answerMap = new Map<string, AnswerPayload>();
        answers.forEach((answer) => {
            assert(answer && typeof answer.questionId === 'string' &&
                typeof answer.response === 'string' && answer.response.trim().length > 0 &&
                answer.response.length <= 2000, 400, 'Each answer must contain 1 to 2000 characters');
            answerMap.set(answer.questionId, answer);
        });

        const assignedPoints: number[] = [];
        for (const question of questions) {
            const answer = answerMap.get(question.id);
            assert(answer, 400, 'Answer missing for question');
            if (question.type === 'numeric') {
                assert(Number.isFinite(Number(answer.response)), 400, 'Numeric answers must be valid numbers');
            }

            if (round.isFinal) {
                assignedPoints.push(0);
            } else {
                assert(typeof answer.pointValue === 'number', 400, 'Point value required for each answer');
                assignedPoints.push(answer.pointValue);
                assert(pointOptions.includes(answer.pointValue), 400, 'Invalid point value assigned');
            }
        }

        if (!round.isFinal) {
            const uniquePoints = new Set(assignedPoints);
            assert(uniquePoints.size === pointOptions.length, 400, 'Each point value must be used exactly once');
        } else {
            const wager = await Wager.findOne({ where: { teamId: team.id, roundId: round.id } });
            assert(wager, 400, 'A wager must be submitted before the final question starts');
        }

        const submissionId = randomUUID();
        const submittedAt = nowUtc();

        await writeTransaction(async (transaction: Transaction) => {
            await round.reload({ transaction });
            assert(round.status === 'open', 409, 'Round is not accepting submissions');
            this.assertWithinDeadline(round);
            const existing = await Submission.findOne({
                where: { teamId: team.id, roundId: round.id },
                transaction,
            });

            assert(!existing, 409, 'Your answers for this round have already been received');

            await Submission.create(
                {
                    id: submissionId,
                    teamId: team.id,
                    roundId: round.id,
                    submittedAt,
                    answersJson: JSON.stringify(answers),
                    status: 'submitted',
                },
                { transaction }
            );

            const wager = round.isFinal
                ? await Wager.findOne({ where: { teamId: team.id, roundId: round.id }, transaction })
                : null;

            for (const question of questions) {
                const answer = answerMap.get(question.id)!;
                const assignedPoint = round.isFinal ? wager?.amount ?? 0 : answer.pointValue ?? 0;

                // Auto-score numeric questions
                let status: 'pending' | 'correct' | 'incorrect' = 'pending';
                let awardedPoints = 0;

                if (question.type === 'numeric' && question.numericConfigJson) {
                    const numericConfig = JSON.parse(question.numericConfigJson);
                    const submittedValue = Number(answer.response);

                    if (Number.isFinite(submittedValue) && Number.isFinite(numericConfig.correctAnswer)) {
                        const percentOff = numericConfig.correctAnswer === 0
                            ? (submittedValue === 0 ? 0 : Infinity)
                            : Math.abs((submittedValue - numericConfig.correctAnswer) / numericConfig.correctAnswer) * 100;

                        // Find the applicable scoring range (pointsPercent can exceed 100 for bonus)
                        const sortedRanges = [...numericConfig.ranges].sort((a: { maxPercentOff: number; pointsPercent: number }, b: { maxPercentOff: number; pointsPercent: number }) => a.maxPercentOff - b.maxPercentOff);
                        let pointsPercent = 0;

                        for (const range of sortedRanges) {
                            if (percentOff <= range.maxPercentOff) {
                                pointsPercent = range.pointsPercent;
                                break;
                            }
                        }

                        if (pointsPercent > 0) {
                            status = 'correct';
                            // pointsPercent can exceed 100 (e.g., 125% for exact answers)
                            awardedPoints = Math.round((assignedPoint * pointsPercent) / 100);
                        } else {
                            status = 'incorrect';
                            // For final round numeric questions, use wagerLossThresholds if defined
                            if (round.isFinal && numericConfig.wagerLossThresholds && numericConfig.wagerLossThresholds.length > 0) {
                                const sortedLossThresholds = [...numericConfig.wagerLossThresholds].sort(
                                    (a: { maxPercentOff: number; wagerLossPercent: number }, b: { maxPercentOff: number; wagerLossPercent: number }) => a.maxPercentOff - b.maxPercentOff
                                );
                                let wagerLossPercent = 100; // Default: lose all if beyond all thresholds

                                for (const threshold of sortedLossThresholds) {
                                    if (percentOff <= threshold.maxPercentOff) {
                                        wagerLossPercent = threshold.wagerLossPercent;
                                        break;
                                    }
                                }

                                awardedPoints = -Math.round((assignedPoint * wagerLossPercent) / 100);
                            } else {
                                awardedPoints = round.isFinal ? -assignedPoint : 0;
                            }
                        }
                    }
                }

                await SubmissionResult.create(
                    {
                        id: randomUUID(),
                        submissionId,
                        questionId: question.id,
                        assignedPoint,
                        status,
                        awardedPoints,
                        updatedAt: submittedAt,
                    },
                    { transaction }
                );
            }

            // Auto-update team score and submission status for numeric questions
            if (questions.some(q => q.type === 'numeric' && q.numericConfigJson)) {
                const results = await SubmissionResult.findAll({
                    where: { submissionId },
                    transaction,
                });

                const totalAwarded = results.reduce((sum, r) => sum + r.awardedPoints, 0);
                const allAutoGraded = results.every(r => r.status !== 'pending');

                if (totalAwarded !== 0) {
                    await team.update({ score: team.score + totalAwarded }, { transaction });
                }

                if (allAutoGraded) {
                    await Submission.update(
                        { status: 'graded' },
                        { where: { id: submissionId }, transaction }
                    );
                }
            }
        });

        await this.broadcastGameState(game.id);

        this.sendSubmissionAck(game.id, team.id, {
            roundId: round.id,
            status: 'accepted',
            message: 'Submission received',
        });
    }

    async openRound(gameCode: string, pin: string, roundId: string): Promise<void> {
        const game = await this.getGameByCode(gameCode);
        assertAdminSecret(pin);

        const round = await this.getRoundById(roundId);
        assert(round.gameId === game.id, 400, 'Round does not belong to this game');

        const openedAt = nowUtc();

        await writeTransaction(async (transaction: Transaction) => {
            const openRound = await Round.findOne({ where: { gameId: game.id, status: 'open' }, transaction });
            assert(!openRound || openRound.id === round.id, 400, 'Another round is already open');
            await round.update({ status: 'open', openedAt, closedAt: null }, { transaction });
            await game.update({ currentRoundId: round.id }, { transaction });
        });

        await this.broadcastGameState(game.id);
    }

    async closeRound(gameCode: string, pin: string, roundId: string): Promise<void> {
        const game = await this.getGameByCode(gameCode);
        assertAdminSecret(pin);

        const round = await this.getRoundById(roundId);
        assert(round.gameId === game.id, 400, 'Round does not belong to this game');

        const closedAt = nowUtc();

        await writeTransaction(async (transaction: Transaction) => {
            await round.update({ status: 'closed', closedAt }, { transaction });
            await game.update({ currentRoundId: null }, { transaction });
        });

        await this.broadcastGameState(game.id);
    }

    async gradeSubmission(gameCode: string, pin: string, submissionId: string, grades: GradePayload[]): Promise<void> {
        const game = await this.getGameByCode(gameCode);
        assertAdminSecret(pin);

        const submission = await Submission.findOne({
            where: { id: submissionId },
            include: [{ model: Team, as: 'team', where: { gameId: game.id } }, { model: Round, as: 'round' }],
        });

        assert(submission, 404, 'Submission not found');
        const round = submission.round!;

        await writeTransaction(async (transaction: Transaction) => {
            const team = await Team.findByPk(submission.teamId, { transaction });
            assert(team, 500, 'Team missing for submission');

            let scoreDelta = 0;

            for (const grade of grades) {
                assert(grade && ['pending', 'correct', 'incorrect'].includes(grade.status), 400, 'Invalid grade status');
                assert(grade.awardedPoints === undefined || Number.isFinite(grade.awardedPoints), 400, 'Awarded points must be finite');
                const result = await SubmissionResult.findOne({
                    where: { submissionId: submission.id, questionId: grade.questionId },
                    transaction,
                });
                assert(result, 404, 'Submission result not found');
                const question = await Question.findByPk(grade.questionId, { transaction });
                assert(question, 404, 'Question not found');

                let awarded = 0;
                if (grade.awardedPoints !== undefined) {
                    // Use custom awarded points if provided (for partial credit)
                    awarded = grade.awardedPoints;
                } else if (question.type === 'numeric' && grade.status === result.status) {
                    awarded = result.awardedPoints;
                } else if (grade.status === 'correct') {
                    awarded = result.assignedPoint ?? 0;
                } else if (grade.status === 'incorrect' && round.isFinal) {
                    awarded = -(result.assignedPoint ?? 0);
                }

                const diff = awarded - result.awardedPoints;

                await result.update({ status: grade.status, awardedPoints: awarded, updatedAt: nowUtc() }, { transaction });

                scoreDelta += diff;
            }

            const pending = await SubmissionResult.count({
                where: { submissionId: submission.id, status: 'pending' },
                transaction,
            });

            if (pending === 0) {
                await submission.update({ status: 'graded' }, { transaction });
            }

            if (scoreDelta !== 0) {
                const nextScore = team.score + scoreDelta;
                await team.update({ score: nextScore }, { transaction });
                team.set('score', nextScore);
            }
        });

        await this.broadcastGameState(game.id);
    }

    async getScoreboard(gameCode: string): Promise<TeamScore[]> {
        const game = await this.getGameByCode(gameCode);
        return this.getScoreboardForGame(game.id);
    }

    async registerClient(
        socket: WebSocket,
        role: ClientRole,
        gameCode: string,
        options: { teamId?: string; teamToken?: string; adminSecret?: string },
    ): Promise<ConnectedClient> {
        const game = await this.getGameByCode(gameCode);

        if (role === 'team') {
            assert(options.teamId && options.teamToken, 401, 'Team credentials required');
            const team = await this.getTeamById(options.teamId);
            assert(team.gameId === game.id, 401, 'Team does not belong to this game');
            assert(team.joinToken === options.teamToken, 401, 'Invalid team token');
        } else if (role === 'gamemaster') {
            assertAdminSecret(options.adminSecret ?? '');
        } else {
            assert(role === 'scoreboard', 400, 'Invalid client role');
        }

        const connected: ConnectedClient = {
            id: randomUUID(),
            socket,
            role,
            gameId: game.id,
            teamId: role === 'team' ? options.teamId : undefined,
        };

        if (!this.clientsByGame.has(game.id)) {
            this.clientsByGame.set(game.id, new Map());
        }
        this.clientsByGame.get(game.id)!.set(connected.id, connected);

        this.sendHelloAck(socket, role);

        this.sendStateToClient(connected).catch((error) => {
            console.error('[ws] failed to send initial state', error);
        });

        return connected;
    }

    unregisterClient(client: ConnectedClient): void {
        const group = this.clientsByGame.get(client.gameId);
        if (!group) {
            return;
        }
        group.delete(client.id);
        if (group.size === 0) {
            this.clientsByGame.delete(client.gameId);
        }
    }

    async broadcastGameState(gameId: string): Promise<void> {
        const group = this.clientsByGame.get(gameId);
        if (!group) {
            return;
        }

        const tasks = Array.from(group.values()).map((client) =>
            this.sendStateToClient(client).catch((error) => {
                console.error('[ws] failed to broadcast state', error);
            })
        );

        await Promise.all(tasks);
    }

    private async sendStateToClient(client: ConnectedClient): Promise<void> {
        let state: ServerGameState;
        if (client.role === 'team') {
            state = await this.buildTeamState(client.gameId, client.teamId!);
        } else if (client.role === 'gamemaster') {
            state = await this.buildGamemasterState(client.gameId);
        } else {
            state = await this.buildScoreboardState(client.gameId);
        }

        this.safeSend(client.socket, {
            type: 'game_state',
            payload: state,
        });
    }

    private sendSubmissionAck(gameId: string, teamId: string, payload: SubmissionAckMessage['payload']): void {
        const group = this.clientsByGame.get(gameId);
        if (!group) {
            return;
        }
        for (const client of group.values()) {
            if (client.role === 'team' && client.teamId === teamId) {
                this.safeSend(client.socket, {
                    type: 'submission_ack',
                    payload,
                });
            }
        }
    }

    private sendWagerAck(gameId: string, teamId: string, payload: WagerAckMessage['payload']): void {
        const group = this.clientsByGame.get(gameId);
        if (!group) {
            return;
        }
        for (const client of group.values()) {
            if (client.role === 'team' && client.teamId === teamId) {
                this.safeSend(client.socket, {
                    type: 'wager_ack',
                    payload,
                });
            }
        }
    }

    private safeSend(socket: WebSocket, message: ServerToClientMessage): void {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(message));
        }
    }

    private disconnectTeamClients(gameId: string, teamId: string, reason: string): void {
        const group = this.clientsByGame.get(gameId);
        if (!group) {
            return;
        }

        for (const client of Array.from(group.values())) {
            if (client.role === 'team' && client.teamId === teamId) {
                this.safeSend(client.socket, {
                    type: 'error',
                    message: reason,
                });
                client.socket.close(1000, 'team removed');
                group.delete(client.id);
            }
        }

        if (group.size === 0) {
            this.clientsByGame.delete(gameId);
        }
    }

    private buildGameSummary(game: Game): GameSummary {
        return {
            id: game.id,
            code: game.code,
            title: game.title,
            currentRoundId: game.currentRoundId,
            createdAt: game.createdAt,
            joiningOpen: game.joiningOpen,
        };
    }

    private async buildTeamState(gameId: string, teamId: string): Promise<TeamGameState> {
        const game = await this.getGameById(gameId);
        const rounds = await this.getRoundViews(gameId, 'team');
        const scoreboard = await this.getScoreboardForGame(gameId);
        const team = await this.getTeamById(teamId);

        const submissions = await Submission.findAll({ where: { teamId }, order: [['submittedAt', 'DESC']] });
        const teamSubmissions: TeamSubmissionSummary[] = submissions.map((submission) => ({
            roundId: submission.roundId,
            status: submission.status === 'graded' ? 'graded' : 'submitted',
            submittedAt: submission.submittedAt,
        }));

        const wagerRows = await Wager.findAll({ where: { teamId } });
        const wagers: TeamWagerSummary[] = wagerRows.map((row) => ({
            teamId: row.teamId,
            roundId: row.roundId,
            amount: row.amount,
            lockedAt: row.lockedAt,
        }));

        const currentRound = rounds.find((round) => round.id === game.currentRoundId);
        const timeRemainingSeconds = this.computeTimeRemaining(currentRound);

        const waitingMessage = !currentRound || currentRound.status !== 'open'
            ? 'Waiting for the gamemaster to start the next round.'
            : undefined;

        return {
            role: 'team',
            game: this.buildGameSummary(game),
            rounds,
            scoreboard,
            lastUpdated: nowUtc(),
            team: {
                id: team.id,
                name: team.name,
                score: team.score,
                submissions: teamSubmissions,
                wagers,
            },
            currentRound,
            timeRemainingSeconds,
            waitingMessage,
        };
    }

    private async buildGamemasterState(gameId: string): Promise<GamemasterGameState> {
        const game = await this.getGameById(gameId);
        const rounds = await this.getRoundViews(gameId, 'gamemaster');
        const scoreboard = await this.getScoreboardForGame(gameId);
        const submissions = await this.getSubmissionViews(gameId);
        const gmWagerRows = await Wager.findAll({
            include: [{ model: Team, as: 'team', where: { gameId }, attributes: ['id'] }],
        });

        const wagers: TeamWagerSummary[] = gmWagerRows.map((row) => ({
            teamId: row.teamId,
            roundId: row.roundId,
            amount: row.amount,
            lockedAt: row.lockedAt,
        }));

        return {
            role: 'gamemaster',
            game: this.buildGameSummary(game),
            rounds,
            scoreboard,
            submissions,
            wagers,
            lastUpdated: nowUtc(),
        };
    }

    private async buildScoreboardState(gameId: string): Promise<ScoreboardGameState> {
        const game = await this.getGameById(gameId);
        const rounds = await this.getRoundViews(gameId, 'scoreboard');
        const scoreboard = await this.getScoreboardForGame(gameId);
        const currentRound = rounds.find((round) => round.id === game.currentRoundId);
        const waitingMessage = !currentRound || currentRound.status !== 'open'
            ? 'Waiting for the next round to begin.'
            : undefined;

        return {
            role: 'scoreboard',
            game: this.buildGameSummary(game),
            rounds,
            scoreboard,
            currentRoundStatus: currentRound?.status ?? 'pending',
            waitingMessage,
            lastUpdated: nowUtc(),
        };
    }

    private async getSubmissionViews(gameId: string): Promise<SubmissionView[]> {
        const submissions = await Submission.findAll({
            include: [{ model: Team, as: 'team', where: { gameId }, attributes: ['id', 'name'] }],
            order: [['submittedAt', 'DESC']],
        });

        const submissionIds = submissions.map((submission) => submission.id);
        const results = submissionIds.length
            ? await SubmissionResult.findAll({
                where: { submissionId: { [Op.in]: submissionIds } },
                order: [['updatedAt', 'DESC']],
            })
            : [];
        const resultsBySubmission = new Map<string, SubmissionResult[]>();
        for (const result of results) {
            const list = resultsBySubmission.get(result.submissionId) ?? [];
            list.push(result);
            resultsBySubmission.set(result.submissionId, list);
        }

        const wagers = await Wager.findAll({
            include: [{ model: Team, as: 'team', where: { gameId }, attributes: ['id'] }],
        });
        const wagerMap = new Map<string, Wager>();
        for (const wager of wagers) {
            wagerMap.set(`${wager.teamId}-${wager.roundId}`, wager);
        }

        return submissions.map((submission) => {
            const answers = JSON.parse(submission.answersJson) as AnswerPayload[];
            const submissionResults = resultsBySubmission.get(submission.id) ?? [];
            const wagerKey = `${submission.teamId}-${submission.roundId}`;
            const wager = wagerMap.get(wagerKey);

            const answersView = answers.map<SubmissionView['answers'][number]>((answer) => {
                const result = submissionResults.find((r) => r.questionId === answer.questionId);
                return {
                    questionId: answer.questionId,
                    response: answer.response,
                    pointValue: answer.pointValue ?? null,
                    status: result?.status === 'correct'
                        ? 'correct'
                        : result?.status === 'incorrect'
                            ? 'incorrect'
                            : 'pending',
                    awardedPoints: result?.awardedPoints ?? 0,
                };
            });

            return {
                id: submission.id,
                teamId: submission.teamId,
                teamName: submission.team?.name ?? 'Unknown team',
                roundId: submission.roundId,
                createdAt: submission.submittedAt,
                answers: answersView,
                wagerAmount: wager?.amount ?? null,
            };
        });
    }

    private async getRoundViews(gameId: string, role: ClientRole): Promise<RoundStateView[]> {
        const rounds = await Round.findAll({ where: { gameId }, order: [['roundIndex', 'ASC']] });
        const labelMap = new Map<string, string>();
        rounds.forEach((round) => {
            labelMap.set(round.id, round.label);
        });

        const views: RoundStateView[] = [];

        for (const round of rounds) {
            const questions = await Question.findAll({
                where: { roundId: round.id },
                order: [['questionIndex', 'ASC']],
            });

            const visibleQuestions = role === 'gamemaster' || round.status !== 'pending' ? questions : [];
            const questionViews = visibleQuestions.map((question) =>
                this.mapQuestion(question, round.status as RoundStatus, role)
            );

            views.push({
                id: round.id,
                index: round.roundIndex,
                label: round.label,
                status: round.status as RoundStatus,
                pointOptions: JSON.parse(round.pointOptions) as number[],
                timeLimitSeconds: round.timeLimitSeconds ?? null,
                isFinal: !!round.isFinal,
                openedAt: round.openedAt,
                closedAt: round.closedAt,
                questions: questionViews,
                mode: (round.mode as RoundStateView['mode']) ?? (round.isFinal ? 'final' : 'standard'),
                linkedRoundId: round.linkedRoundId,
                linkedRoundLabel: round.linkedRoundId ? labelMap.get(round.linkedRoundId) ?? null : null,
            });
        }

        return views;
    }

    private mapQuestion(row: Question, status: RoundStatus, role: ClientRole): RoundQuestionView {
        const choices = row.choicesJson ? (JSON.parse(row.choicesJson) as string[]) : undefined;
        const correct = row.correctJson ? JSON.parse(row.correctJson) : null;
        const numericConfig = row.numericConfigJson ? JSON.parse(row.numericConfigJson) : null;

        const shouldReveal = role === 'gamemaster' || status === 'closed';

        let correctChoiceIndices: number[] | null = null;
        let correctAnswerText: string | null = null;

        if (shouldReveal && correct !== null) {
            if (row.type === 'mcq') {
                if (Array.isArray(correct)) {
                    correctChoiceIndices = correct as number[];
                } else if (typeof correct === 'number') {
                    correctChoiceIndices = [correct];
                }
            } else if (typeof correct === 'string') {
                correctAnswerText = correct;
            } else if (typeof correct === 'number') {
                correctAnswerText = correct.toString();
            }
        }

        const questionType = row.type === 'mcq' ? 'mcq' : row.type === 'numeric' ? 'numeric' : 'open';

        return {
            id: row.id,
            order: row.questionIndex,
            type: questionType as 'mcq' | 'open' | 'numeric',
            text: row.text,
            choices,
            explanation: shouldReveal ? row.explanation ?? null : null,
            correctChoiceIndices,
            correctAnswerText,
            numericConfig: shouldReveal ? numericConfig ?? null : null,
        };
    }

    private computeTimeRemaining(round?: RoundStateView): number | null {
        if (!round || !round.openedAt || !round.timeLimitSeconds || round.status !== 'open') {
            return null;
        }
        const opened = Date.parse(round.openedAt);
        const end = opened + round.timeLimitSeconds * 1000;
        return Math.max(0, Math.ceil((end - Date.now()) / 1000));
    }

    private assertWithinDeadline(round: Round): void {
        if (round.openedAt && round.timeLimitSeconds !== null && round.timeLimitSeconds > 0) {
            assert(Date.now() < Date.parse(round.openedAt) + round.timeLimitSeconds * 1000,
                409, 'Time is up for this round');
        }
    }

    private async getScoreboardForGame(gameId: string): Promise<TeamScore[]> {
        const teams = await Team.findAll({
            where: { gameId },
            order: [['score', 'DESC'], ['name', 'ASC']],
        });

        return teams.map((team) => ({ teamId: team.id, name: team.name, score: team.score }));
    }

    private async getGameByCode(code: string): Promise<Game> {
        const game = await Game.findOne({ where: { code: code.toUpperCase() } });
        assert(game, 404, 'Game not found');
        return game!;
    }

    private async getGameById(id: string): Promise<Game> {
        const game = await Game.findByPk(id);
        assert(game, 404, 'Game not found');
        return game!;
    }

    private async getRoundById(id: string): Promise<Round> {
        const round = await Round.findByPk(id);
        assert(round, 404, 'Round not found');
        return round!;
    }

    private async getQuestionsForRound(roundId: string): Promise<Question[]> {
        return Question.findAll({ where: { roundId }, order: [['questionIndex', 'ASC']] });
    }

    private async getTeamById(id: string): Promise<Team> {
        const team = await Team.findByPk(id);
        assert(team, 404, 'Team not found');
        return team!;
    }

    private parseImportPayload(payload: unknown): ImportPayload {
        let candidate: unknown = payload;

        if (typeof candidate === 'string') {
            try {
                candidate = JSON.parse(candidate);
            } catch (error) {
                throw new HttpError(400, 'Import file must be valid JSON');
            }
        } else if (Buffer.isBuffer(candidate)) {
            try {
                candidate = JSON.parse(candidate.toString('utf8'));
            } catch (error) {
                throw new HttpError(400, 'Import file must be valid JSON');
            }
        }

        assert(candidate && typeof candidate === 'object', 400, 'Invalid import payload');
        const value = candidate as Partial<ImportPayload>;
        assert(Array.isArray(value.rounds) && value.rounds.length > 0, 400, 'At least one round is required');

        value.rounds.forEach((round, index) => {
            assert(round, 400, `Round ${index + 1} is invalid`);
            assert(Array.isArray(round.pointOptions) && round.pointOptions.length > 0, 400, 'pointOptions are required for each round');
            assert(Array.isArray(round.questions) && round.questions.length > 0, 400, 'Each round must contain questions');
            round.pointOptions.forEach((option) => {
                assert(Number.isInteger(option), 400, 'Point options must be integers');
            });
            round.questions.forEach((question, qIndex) => {
                assert(question, 400, `Question ${qIndex + 1} in round ${index + 1} is invalid`);
                assert(question.type === 'mcq' || question.type === 'open' || question.type === 'numeric', 400, 'Question type must be mcq, open, or numeric');
                assert(typeof question.text === 'string' && question.text.trim().length > 0, 400, 'Question text is required');
                if (question.type === 'mcq') {
                    assert(Array.isArray(question.choices) && question.choices.length >= 2, 400, 'MCQ questions require at least two choices');
                    if (question.correctChoiceIndices) {
                        assert(Array.isArray(question.correctChoiceIndices) && question.correctChoiceIndices.length > 0, 400, 'correctChoiceIndices must include at least one index');
                    } else {
                        assert(typeof question.correctChoiceIndex === 'number', 400, 'MCQ question requires correctChoiceIndex or correctChoiceIndices');
                    }
                } else if (question.type === 'numeric') {
                    assert(question.numericConfig, 400, 'Numeric questions require numericConfig');
                    assert(typeof question.numericConfig.correctAnswer === 'number', 400, 'numericConfig.correctAnswer must be a number');
                    assert(Array.isArray(question.numericConfig.ranges) && question.numericConfig.ranges.length > 0, 400, 'numericConfig.ranges must be a non-empty array');
                    question.numericConfig.ranges.forEach((range, rIndex) => {
                        assert(typeof range.maxPercentOff === 'number' && range.maxPercentOff >= 0, 400, `Range ${rIndex + 1}: maxPercentOff must be a non-negative number`);
                        // pointsPercent can exceed 100 (e.g., 125% bonus for exact answers)
                        assert(typeof range.pointsPercent === 'number' && range.pointsPercent >= 0, 400, `Range ${rIndex + 1}: pointsPercent must be a non-negative number`);
                    });
                    // Validate wagerLossThresholds if present
                    if (question.numericConfig.wagerLossThresholds) {
                        assert(Array.isArray(question.numericConfig.wagerLossThresholds), 400, 'wagerLossThresholds must be an array');
                        question.numericConfig.wagerLossThresholds.forEach((threshold, tIndex) => {
                            assert(typeof threshold.maxPercentOff === 'number' && threshold.maxPercentOff >= 0, 400, `Wager loss threshold ${tIndex + 1}: maxPercentOff must be a non-negative number`);
                            assert(typeof threshold.wagerLossPercent === 'number' && threshold.wagerLossPercent >= 0 && threshold.wagerLossPercent <= 100, 400, `Wager loss threshold ${tIndex + 1}: wagerLossPercent must be between 0 and 100`);
                        });
                    }
                } else {
                    assert(typeof question.answer === 'string' && question.answer.trim().length > 0, 400, 'Open questions require an answer');
                }
            });
            assert(round.pointOptions.length === round.questions.length || round.isFinal, 400, 'Point options must match question count for non-final rounds');
        });

        return value as ImportPayload;
    }

    private encodeCorrectAnswer(question: ImportQuestion): string | null {
        if (question.type === 'mcq') {
            if (Array.isArray(question.correctChoiceIndices)) {
                return JSON.stringify(question.correctChoiceIndices);
            }
            return JSON.stringify([question.correctChoiceIndex ?? 0]);
        }
        if (question.type === 'numeric' && question.numericConfig) {
            return JSON.stringify(question.numericConfig.correctAnswer);
        }
        return question.answer ? JSON.stringify(question.answer) : null;
    }

    private async clearGameContent(gameId: string, transaction: Transaction): Promise<void> {
        const teams = await Team.findAll({ where: { gameId }, attributes: ['id'], transaction });
        const teamIds = teams.map((team) => team.id);

        if (teamIds.length > 0) {
            const submissions = await Submission.findAll({
                where: { teamId: { [Op.in]: teamIds } },
                attributes: ['id'],
                transaction,
            });
            const submissionIds = submissions.map((submission) => submission.id);

            if (submissionIds.length > 0) {
                await SubmissionResult.destroy({ where: { submissionId: { [Op.in]: submissionIds } }, transaction });
                await Submission.destroy({ where: { id: { [Op.in]: submissionIds } }, transaction });
            }

            await Wager.destroy({ where: { teamId: { [Op.in]: teamIds } }, transaction });
            await Team.update({ score: 0 }, { where: { id: { [Op.in]: teamIds } }, transaction });
        }

        const rounds = await Round.findAll({ where: { gameId }, attributes: ['id'], transaction });
        const roundIds = rounds.map((round) => round.id);

        if (roundIds.length > 0) {
            await Question.destroy({ where: { roundId: { [Op.in]: roundIds } }, transaction });
            await Round.destroy({ where: { id: { [Op.in]: roundIds } }, transaction });
        }
    }

    private sendHelloAck(socket: WebSocket, role: ClientRole): void {
        this.safeSend(socket, {
            type: 'hello_ack',
            role,
        });
    }
}

export default GameManager;
