import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RoundStateView } from '@shared/types';
import { joinTeam, submitAnswers, submitWager } from '../api';
import { useTriviaSocket } from '../hooks/useTriviaSocket';

type ConnectionStatus = 'online' | 'offline' | 'error' | null;

interface TeamSession {
    gameCode: string;
    teamId: string;
    teamToken: string;
    teamName: string;
}

interface AnswerDraft {
    response: string;
    pointValue: number | null;
}

interface TeamTopBarState {
    teamName: string;
    gameTitle: string | null;
    onLeave: () => void;
}

interface TeamPageProps {
    onConnectionStatusChange?: (status: ConnectionStatus) => void;
    onSessionChange?: (state: TeamTopBarState | null) => void;
}

const STORAGE_KEY = 'trivia.team.session.v1';

function loadSession(): TeamSession | null {
    if (typeof window === 'undefined') {
        return null;
    }
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return null;
        }
        return JSON.parse(raw) as TeamSession;
    } catch (error) {
        console.warn('Unable to parse team session', error);
        return null;
    }
}

function persistSession(session: TeamSession | null): void {
    if (typeof window === 'undefined') {
        return;
    }
    if (!session) {
        window.localStorage.removeItem(STORAGE_KEY);
        return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function TeamPage({ onConnectionStatusChange, onSessionChange }: TeamPageProps): JSX.Element {
    const [session, setSession] = useState<TeamSession | null>(() => loadSession());
    const [gameCodeInput, setGameCodeInput] = useState('');
    const [teamNameInput, setTeamNameInput] = useState('');
    const [joinError, setJoinError] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [answers, setAnswers] = useState<Record<string, AnswerDraft>>({});
    const [wagerAmount, setWagerAmount] = useState('');
    const [working, setWorking] = useState(false);
    const [localTimeRemaining, setLocalTimeRemaining] = useState<number | null>(null);
    const statusTimerRef = useRef<number | null>(null);

    const handleLeave = useCallback(() => {
        setSession(null);
        setAnswers({});
        setWagerAmount('');
        persistSession(null);
        setStatusMessage('Cleared local team session.');
        onSessionChange?.(null);
    }, [onSessionChange]);

    const socket = useTriviaSocket(
        session
            ? {
                role: 'team',
                gameCode: session.gameCode,
                teamId: session.teamId,
                teamToken: session.teamToken,
            }
            : null,
    );

    const teamState = socket.state && socket.state.role === 'team' ? socket.state : null;
    const currentRound = teamState?.currentRound ?? null;
    const teamInfo = teamState?.team;
    const currentScore = teamInfo?.score ?? 0;
    const timeRemaining = teamState?.timeRemainingSeconds ?? null;
    const waitingMessage = teamState?.waitingMessage;
    const roundIsOpen = Boolean(currentRound && currentRound.status === 'open');
    const displayTimeRemaining = roundIsOpen && localTimeRemaining != null ? localTimeRemaining : timeRemaining;

    useEffect(() => {
        if (!session) {
            return;
        }
        persistSession(session);
    }, [session]);

    useEffect(() => {
        if (!session || !teamState?.team) {
            return;
        }
        persistSession({
            gameCode: teamState.game.code,
            teamId: teamState.team.id,
            teamToken: session.teamToken,
            teamName: teamState.team.name,
        });
    }, [teamState, session]);

    useEffect(() => {
        if (typeof teamState?.timeRemainingSeconds === 'number') {
            setLocalTimeRemaining(teamState.timeRemainingSeconds);
        } else {
            setLocalTimeRemaining(null);
        }
    }, [teamState?.timeRemainingSeconds, currentRound?.id]);

    useEffect(() => {
        if (!onSessionChange) {
            return;
        }
        if (!session) {
            onSessionChange(null);
            return;
        }
        onSessionChange({
            teamName: teamInfo?.name ?? session.teamName,
            gameTitle: teamState?.game.title ?? null,
            onLeave: handleLeave,
        });
    }, [session, teamInfo?.name, teamState?.game.title, onSessionChange, handleLeave]);

    useEffect(() => {
        if (!onConnectionStatusChange) {
            return;
        }
        if (!session) {
            onConnectionStatusChange(null);
            return;
        }
        const status: ConnectionStatus = socket.error
            ? 'error'
            : socket.connected
                ? 'online'
                : 'offline';
        onConnectionStatusChange(status);
    }, [session, socket.connected, socket.error, onConnectionStatusChange]);

    useEffect(() => {
        return () => {
            onConnectionStatusChange?.(null);
        };
    }, [onConnectionStatusChange]);

    useEffect(() => {
        if (!roundIsOpen) {
            return;
        }
        const timer = window.setInterval(() => {
            setLocalTimeRemaining((prev) => {
                if (prev == null) {
                    return prev;
                }
                return prev > 0 ? prev - 1 : 0;
            });
        }, 1000);
        return () => window.clearInterval(timer);
    }, [roundIsOpen, currentRound?.id]);

    useEffect(() => {
        if (!currentRound) {
            setAnswers({});
            return;
        }
        setAnswers((prev) => {
            const next: Record<string, AnswerDraft> = {};
            currentRound.questions.forEach((question) => {
                const existing = prev[question.id] ?? { response: '', pointValue: null };
                // Auto-select point value if there's only 1 question and 1 point option
                const autoSelectPointValue =
                    !currentRound.isFinal &&
                    currentRound.questions.length === 1 &&
                    currentRound.pointOptions.length === 1 &&
                    existing.pointValue === null;

                next[question.id] = {
                    response: existing.response,
                    pointValue: autoSelectPointValue ? currentRound.pointOptions[0] : existing.pointValue,
                };
            });
            return next;
        });
    }, [currentRound?.id]);

    useEffect(() => {
        if (!teamInfo) {
            setWagerAmount('');
            return;
        }
        if (!currentRound) {
            return;
        }
        const targetRoundId = currentRound.mode === 'wager'
            ? currentRound.linkedRoundId ?? undefined
            : currentRound.isFinal
                ? currentRound.id
                : undefined;

        if (!targetRoundId) {
            return;
        }

        const existingWager = teamInfo.wagers.find((entry) => entry.roundId === targetRoundId);
        if (existingWager) {
            setWagerAmount(existingWager.amount.toString());
        } else {
            setWagerAmount('');
        }
    }, [currentRound, teamInfo]);

    useEffect(() => {
        if (socket.submissionAck) {
            setStatusMessage(socket.submissionAck.message ?? `Submission ${socket.submissionAck.status}`);
        }
    }, [socket.submissionAck]);

    useEffect(() => {
        if (socket.wagerAck) {
            setStatusMessage(socket.wagerAck.message ?? `Wager ${socket.wagerAck.status}`);
        }
    }, [socket.wagerAck]);

    useEffect(() => {
        if (!statusMessage) {
            return;
        }
        if (statusTimerRef.current != null) {
            window.clearTimeout(statusTimerRef.current);
        }
        statusTimerRef.current = window.setTimeout(() => {
            setStatusMessage(null);
            statusTimerRef.current = null;
        }, 10_000);
        return () => {
            if (statusTimerRef.current != null) {
                window.clearTimeout(statusTimerRef.current);
                statusTimerRef.current = null;
            }
        };
    }, [statusMessage]);

    const hasSession = Boolean(session);

    const roundPointAssignments = useMemo(() => {
        const map = new Map<number, string>();
        Object.entries(answers).forEach(([questionId, draft]) => {
            if (draft.pointValue != null) {
                map.set(draft.pointValue, questionId);
            }
        });
        return map;
    }, [answers]);

    const handleJoin = async (event: React.FormEvent) => {
        event.preventDefault();
        setJoinError(null);
        setStatusMessage(null);
        try {
            if (!gameCodeInput.trim() || !teamNameInput.trim()) {
                throw new Error('Game code and team name are required');
            }
            setWorking(true);
            const result = await joinTeam(gameCodeInput.trim().toUpperCase(), teamNameInput.trim());
            const nextSession: TeamSession = {
                gameCode: gameCodeInput.trim().toUpperCase(),
                teamId: result.teamId,
                teamToken: result.teamToken,
                teamName: result.name,
            };
            setSession(nextSession);
            persistSession(nextSession);
            setStatusMessage('Joined game successfully.');
            setGameCodeInput('');
            setTeamNameInput('');
        } catch (error) {
            setJoinError(error instanceof Error ? error.message : 'Unable to join game');
        } finally {
            setWorking(false);
        }
    };

    const handleResponseChange = (questionId: string, response: string) => {
        setAnswers((prev) => ({
            ...prev,
            [questionId]: {
                response,
                pointValue: prev[questionId]?.pointValue ?? null,
            },
        }));
    };

    const handlePointValueChange = (questionId: string, value: number | null) => {
        setAnswers((prev) => {
            const next: Record<string, AnswerDraft> = { ...prev };
            const current = next[questionId] ?? { response: '', pointValue: null };

            if (value != null) {
                Object.entries(next).forEach(([otherId, draft]) => {
                    if (otherId !== questionId && draft.pointValue === value) {
                        next[otherId] = { ...draft, pointValue: null };
                    }
                });
            }

            next[questionId] = {
                response: current.response,
                pointValue: value,
            };

            return next;
        });
    };

    const handleSubmitAnswers = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!session || !currentRound) {
            return;
        }
        if (currentRound.mode === 'wager') {
            setStatusMessage('Use the wager form to lock in your bet before submitting answers.');
            return;
        }
        try {
            setWorking(true);
            const answerPayload = currentRound.questions.map((question) => {
                const draft = answers[question.id] ?? { response: '', pointValue: null };
                if (!draft.response.trim()) {
                    throw new Error('All answers must be filled in before submitting.');
                }
                return {
                    questionId: question.id,
                    response: draft.response.trim(),
                    pointValue: currentRound.isFinal ? null : draft.pointValue,
                };
            });

            if (!currentRound.isFinal) {
                const values = answerPayload.map((entry) => entry.pointValue);
                if (values.some((value) => value == null)) {
                    throw new Error('Assign every point value to a question.');
                }
                const numericValues = values.filter((value): value is number => value != null);
                const uniqueValues = new Set(numericValues);
                if (uniqueValues.size !== currentRound.pointOptions.length) {
                    throw new Error('Use each point value exactly once.');
                }
            }

            await submitAnswers({
                gameCode: session.gameCode,
                teamId: session.teamId,
                teamToken: session.teamToken,
                roundId: currentRound.id,
                answers: answerPayload,
            });
            setStatusMessage('Submission sent!');
        } catch (error) {
            setStatusMessage(error instanceof Error ? error.message : 'Unable to submit answers');
        } finally {
            setWorking(false);
        }
    };

    const handleSubmitWager = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!session || !currentRound || !teamInfo) {
            return;
        }
        try {
            const amount = Number.parseInt(wagerAmount, 10);
            if (!Number.isFinite(amount) || amount < 0) {
                throw new Error('Enter a valid non-negative wager.');
            }
            if (amount > teamInfo.score) {
                throw new Error('Wager cannot exceed your current score.');
            }
            setWorking(true);
            await submitWager(session.gameCode, session.teamId, session.teamToken, currentRound.id, amount);
            setStatusMessage('Wager submitted!');
        } catch (error) {
            setStatusMessage(error instanceof Error ? error.message : 'Unable to submit wager');
        } finally {
            setWorking(false);
        }
    };
    const currentSubmission = useMemo(() => {
        if (!currentRound || !teamInfo) {
            return null;
        }
        return teamInfo.submissions.find((entry) => entry.roundId === currentRound.id) ?? null;
    }, [teamInfo?.submissions, currentRound?.id]);

    const hasSubmittedCurrentRound = currentSubmission ? currentSubmission.status !== 'not_submitted' : false;
    const showWagerForm = Boolean(session && currentRound && roundIsOpen && currentRound.mode === 'wager');
    const showQuestionForm = Boolean(
        session &&
        currentRound &&
        roundIsOpen &&
        currentRound.mode !== 'wager' &&
        !hasSubmittedCurrentRound,
    );
    const showStatusCard = Boolean(session && !showQuestionForm && !showWagerForm);

    const statusDetails = useMemo(() => {
        if (!session) {
            return null;
        }
        if (!currentRound) {
            return {
                title: 'Waiting for the next round',
                description: waitingMessage ?? 'Your host will bring up the next question shortly.',
            };
        }
        if (currentRound.mode === 'wager' && currentRound.status !== 'open') {
            return {
                title: `${currentRound.label} wager locked`,
                description: waitingMessage ?? 'Final question will begin soon.',
            };
        }
        if (hasSubmittedCurrentRound) {
            return {
                title: 'Submission received',
                description: 'Nice work! Sit tight while the host reviews answers.',
            };
        }
        if (currentRound.status === 'closed') {
            return {
                title: `${currentRound.label} closed`,
                description: waitingMessage ?? 'Awaiting scoring.',
            };
        }
        return {
            title: 'Team status',
            description: waitingMessage ?? 'Waiting for the host to begin.',
        };
    }, [session, currentRound, waitingMessage, hasSubmittedCurrentRound]);

    const renderJoinCard = () => (
        <section className="panel team-card team-card--join">
            <h3>Join a Game</h3>
            <form onSubmit={handleJoin} className="join-form">
                <label className="field">
                    <span>Game Code</span>
                    <input
                        value={gameCodeInput}
                        onChange={(event) => setGameCodeInput(event.target.value.toUpperCase())}
                        placeholder="ABCDE"
                        maxLength={6}
                        required
                        autoComplete="off"
                    />
                </label>
                <label className="field">
                    <span>Team Name</span>
                    <input
                        value={teamNameInput}
                        onChange={(event) => setTeamNameInput(event.target.value)}
                        placeholder="Trivia Titans"
                        required
                        autoComplete="off"
                    />
                </label>
                {joinError && <p className="error">{joinError}</p>}
                <button type="submit" className="primary" disabled={working}>
                    Join Game
                </button>
            </form>
        </section>
    );

    const renderStatusCard = () => (
        <section className="panel team-card team-card--status">
            <header className="team-card-header">
                <div>
                    <h3>{statusDetails?.title ?? 'Team status'}</h3>
                    <p className="team-card-subtitle">
                        Playing as <strong>{teamInfo?.name ?? session?.teamName}</strong> in game {session?.gameCode}
                    </p>
                </div>
                <button type="button" className="ghost-button" onClick={handleLeave}>
                    Leave Game
                </button>
            </header>
            <div className="team-card-body">
                <dl className="team-metrics">
                    <div>
                        <dt>Score</dt>
                        <dd>{currentScore}</dd>
                    </div>
                    {typeof displayTimeRemaining === 'number' && displayTimeRemaining >= 0 && (
                        <div>
                            <dt>Time remaining</dt>
                            <dd>{displayTimeRemaining}s</dd>
                        </div>
                    )}
                    {currentSubmission && (
                        <div>
                            <dt>Status</dt>
                            <dd>
                                {currentSubmission.status === 'graded' ? 'Graded' : 'Submitted'}
                                {currentSubmission.submittedAt && (
                                    <span>
                                        {' '}
                                        at {new Date(currentSubmission.submittedAt).toLocaleTimeString()}
                                    </span>
                                )}
                            </dd>
                        </div>
                    )}
                </dl>
                {statusDetails?.description && <p className="panel-subhead">{statusDetails.description}</p>}
                {waitingMessage && !roundIsOpen && <p className="info-banner">{waitingMessage}</p>}
                {statusMessage && <p className="status">{statusMessage}</p>}
                {socket.error && <p className="error">{socket.error}</p>}
            </div>
        </section>
    );

    const renderQuestionCard = (round: RoundStateView) => {
        const badgeLabel = round.isFinal ? 'Final Round' : `Round ${round.index + 1}`;
        const instructions = round.isFinal
            ? 'Answer the final question. Your wager determines how many points you win or lose.'
            : 'Assign each point value once across the questions before submitting.';

        return (
            <form className="panel team-card team-card--question" onSubmit={handleSubmitAnswers}>
                <header className="team-card-header">
                    <div>
                        <span className="stage-badge">{badgeLabel}</span>
                        <h3>{round.label}</h3>
                    </div>
                    <div className="team-card-meta">
                        <span>Score: {currentScore}</span>
                        {typeof displayTimeRemaining === 'number' && displayTimeRemaining >= 0 && (
                            <span>Time: {displayTimeRemaining}s</span>
                        )}
                    </div>
                </header>
                <p className="panel-subhead">{instructions}</p>
                <div className="question-list">
                    {round.questions.map((question) => {
                        const draft = answers[question.id] ?? { response: '', pointValue: null };
                        const pointValueOptions = round.isFinal
                            ? []
                            : round.pointOptions.map((point) => {
                                const assignedQuestion = roundPointAssignments.get(point);
                                return {
                                    point,
                                    assignedQuestion,
                                    assignedToThisQuestion: assignedQuestion === question.id,
                                };
                            });

                        return (
                            <div key={question.id} className="question-card">
                                <header>
                                    <span className="question-order">Q{question.order + 1}</span>
                                    <h4>{question.text}</h4>
                                </header>
                                {question.choices && (
                                    <ul className="choice-list">
                                        {question.choices.map((choice, index) => (
                                            <li key={index}>{choice}</li>
                                        ))}
                                    </ul>
                                )}
                                <label className="field">
                                    <span>Your Answer</span>
                                    <textarea
                                        required
                                        value={draft.response}
                                        onChange={(event) => handleResponseChange(question.id, event.target.value)}
                                        placeholder="Type your answer"
                                    />
                                </label>
                                {!round.isFinal && (
                                    <label className="field">
                                        <span>Point Value</span>
                                        <select
                                            required
                                            value={draft.pointValue ?? ''}
                                            onChange={(event) =>
                                                handlePointValueChange(
                                                    question.id,
                                                    event.target.value ? Number(event.target.value) : null,
                                                )
                                            }
                                        >
                                            <option value="" disabled>
                                                Select point value
                                            </option>
                                            {pointValueOptions.map(({ point, assignedQuestion, assignedToThisQuestion }) => (
                                                <option key={point} value={point}>
                                                    {point}
                                                    {assignedQuestion && !assignedToThisQuestion ? ' (taken)' : ''}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                )}
                            </div>
                        );
                    })}
                </div>
                {statusMessage && <p className="status">{statusMessage}</p>}
                {socket.error && <p className="error">{socket.error}</p>}
                <div className="form-actions">
                    <button type="submit" className="primary" disabled={working}>
                        Submit Answers
                    </button>
                </div>
            </form>
        );
    };

    const renderWagerCard = (round: RoundStateView) => (
        <section className="panel team-card team-card--question">
            <header className="team-card-header">
                <div>
                    <span className="stage-badge">Final Wager</span>
                    <h3>{round.label}</h3>
                </div>
                <div className="team-card-meta">
                    <span>Score: {currentScore}</span>
                    {typeof displayTimeRemaining === 'number' && displayTimeRemaining >= 0 && (
                        <span>Time: {displayTimeRemaining}s</span>
                    )}
                </div>
            </header>
            <p className="panel-subhead">
                Lock in your wager for {round.linkedRoundLabel ?? 'the final round'} before time expires.
            </p>
            <form onSubmit={handleSubmitWager} className="wager-form wager-form--standalone">
                <label className="field">
                    <span>Wager Amount (max {teamInfo?.score ?? 0})</span>
                    <input
                        type="number"
                        min={0}
                        max={teamInfo?.score ?? 0}
                        value={wagerAmount}
                        onChange={(event) => setWagerAmount(event.target.value)}
                        required
                    />
                </label>
                <div className="form-actions">
                    <button type="submit" className="primary" disabled={working}>
                        Submit Wager
                    </button>
                </div>
            </form>
            {statusMessage && <p className="status">{statusMessage}</p>}
            {socket.error && <p className="error">{socket.error}</p>}
        </section>
    );

    return (
        <div className="page team-page">
            <h2>Team Console</h2>
            {!session && renderJoinCard()}
            {session && (
                <>
                    {showStatusCard && renderStatusCard()}
                    {showWagerForm && currentRound && renderWagerCard(currentRound)}
                    {showQuestionForm && currentRound && renderQuestionCard(currentRound)}
                </>
            )}
        </div>
    );
}

export default TeamPage;
