import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import type { GamemasterGameState, SubmissionView } from '@shared/types';
import { gradeSubmission } from '../api';
import { useTriviaSocket } from '../hooks/useTriviaSocket';

type SubmissionStatus = SubmissionView['answers'][number]['status'];
type SubmissionDrafts = Record<string, Record<string, SubmissionStatus>>;

function GamemasterSubmissionsPage(): JSX.Element {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const gameCode = searchParams.get('game');
    const pin = searchParams.get('pin');

    const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
    const [gradeDrafts, setGradeDrafts] = useState<SubmissionDrafts>({});
    const [working, setWorking] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    const socket = useTriviaSocket(
        gameCode && pin
            ? {
                role: 'gamemaster',
                gameCode,
                pin,
            }
            : null,
    );

    const gmState: GamemasterGameState | null = useMemo(() => {
        if (socket.state?.role === 'gamemaster') {
            return socket.state;
        }
        return null;
    }, [socket.state]);

    const activeRoundId = useMemo(() => {
        if (!gmState) {
            return null;
        }
        if (gmState.game.currentRoundId) {
            return gmState.game.currentRoundId;
        }
        return gmState.submissions.length ? gmState.submissions[0].roundId : null;
    }, [gmState]);

    const activeRound = useMemo(() => {
        if (!gmState || !activeRoundId) {
            return null;
        }
        return gmState.rounds.find((round) => round.id === activeRoundId) ?? null;
    }, [gmState, activeRoundId]);

    const submissionsForActiveRound = useMemo(() => {
        if (!gmState || !activeRoundId) {
            return [];
        }
        return gmState.submissions.filter((submission) => submission.roundId === activeRoundId);
    }, [gmState, activeRoundId]);

    const submissionsByTeam = useMemo(() => {
        const map = new Map<string, SubmissionView>();
        submissionsForActiveRound.forEach((submission) => {
            const existing = map.get(submission.teamId);
            if (!existing || new Date(submission.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
                map.set(submission.teamId, submission);
            }
        });
        return map;
    }, [submissionsForActiveRound]);

    const teamTiles = useMemo(() => {
        if (!gmState) {
            return [] as Array<{
                teamId: string;
                name: string;
                score: number;
                status: 'waiting' | 'in_review' | 'graded';
                submittedAt: string | null;
                submissionId: string | null;
            }>;
        }

        const tiles = gmState.scoreboard.map((entry) => {
            const submission = submissionsByTeam.get(entry.teamId);
            const statuses = submission
                ? submission.answers.map((answer) => gradeDrafts[submission.id]?.[answer.questionId] ?? answer.status)
                : [];
            const status: 'waiting' | 'in_review' | 'graded' = submission
                ? statuses.every((state) => state === 'correct' || state === 'incorrect')
                    ? 'graded'
                    : 'in_review'
                : 'waiting';

            return {
                teamId: entry.teamId,
                name: entry.name,
                score: entry.score,
                status,
                submittedAt: submission?.createdAt ?? null,
                submissionId: submission?.id ?? null,
            };
        });

        submissionsForActiveRound.forEach((submission) => {
            if (!tiles.some((tile) => tile.teamId === submission.teamId)) {
                const statuses = submission.answers.map((answer) => gradeDrafts[submission.id]?.[answer.questionId] ?? answer.status);
                const status: 'waiting' | 'in_review' | 'graded' = statuses.every((state) => state === 'correct' || state === 'incorrect')
                    ? 'graded'
                    : 'in_review';
                tiles.push({
                    teamId: submission.teamId,
                    name: submission.teamName,
                    score: 0,
                    status,
                    submittedAt: submission.createdAt,
                    submissionId: submission.id,
                });
            }
        });

        return tiles;
    }, [gmState, submissionsByTeam, submissionsForActiveRound, gradeDrafts]);

    useEffect(() => {
        if (!gmState) {
            return;
        }
        setGradeDrafts((current) => {
            const next: SubmissionDrafts = { ...current };
            gmState.submissions.forEach((submission) => {
                if (!next[submission.id]) {
                    next[submission.id] = {};
                }
                submission.answers.forEach((answer) => {
                    next[submission.id][answer.questionId] = answer.status;
                });
            });
            return next;
        });
    }, [gmState]);

    useEffect(() => {
        if (!gmState) {
            if (selectedTeamId !== null) {
                setSelectedTeamId(null);
            }
            return;
        }

        if (selectedTeamId && teamTiles.some((tile) => tile.teamId === selectedTeamId)) {
            return;
        }

        const pendingTile = teamTiles.find((tile) => tile.status === 'in_review');
        const fallbackTile = pendingTile ?? teamTiles.find((tile) => tile.status === 'waiting') ?? teamTiles[0] ?? null;
        const nextId = fallbackTile?.teamId ?? null;

        if (nextId !== selectedTeamId) {
            setSelectedTeamId(nextId);
        }
    }, [gmState, teamTiles, selectedTeamId]);

    const handleGradeChange = (submissionId: string, questionId: string, status: SubmissionStatus) => {
        setGradeDrafts((current) => ({
            ...current,
            [submissionId]: {
                ...(current[submissionId] ?? {}),
                [questionId]: status,
            },
        }));
    };

    const handleSubmitGrades = async (submission: SubmissionView) => {
        if (!gameCode || !pin) {
            return;
        }
        const draft = gradeDrafts[submission.id];
        if (!draft) {
            setStatusMessage('No grades selected for this submission.');
            return;
        }

        try {
            setWorking(true);
            await gradeSubmission(gameCode, pin, submission.id, submission.answers.map((answer) => ({
                questionId: answer.questionId,
                status: draft[answer.questionId] ?? answer.status,
            })));
            setStatusMessage(`Grades submitted for ${submission.teamName}.`);
        } catch (error) {
            setStatusMessage(error instanceof Error ? error.message : 'Unable to submit grades.');
        } finally {
            setWorking(false);
        }
    };

    const selectedTile = selectedTeamId ? teamTiles.find((tile) => tile.teamId === selectedTeamId) ?? null : null;
    const selectedSubmission = selectedTile?.submissionId ? submissionsByTeam.get(selectedTile.teamId) ?? null : null;
    const selectedScoreboardEntry = selectedTeamId && gmState
        ? gmState.scoreboard.find((entry) => entry.teamId === selectedTeamId) ?? null
        : null;
    const selectedRound = selectedSubmission
        ? gmState?.rounds.find((round) => round.id === selectedSubmission.roundId) ?? activeRound
        : activeRound;

    if (!gameCode || !pin) {
        return (
            <div className="page">
                <h2>Manage Submissions</h2>
                <p className="error">Missing game code or PIN in URL parameters.</p>
                <button type="button" onClick={() => navigate('/gamemaster')}>
                    Back to Gamemaster Console
                </button>
            </div>
        );
    }

    return (
        <div className="page gamemaster-submissions-page">
            <div className="page-header">
                <div>
                    <h2>Manage Submissions{activeRound ? ` – ${activeRound.label}` : ''}</h2>
                    <p className="page-subhead">Review and grade team submissions for the current round.</p>
                </div>
                <button type="button" className="ghost-button" onClick={() => navigate('/gamemaster')}>
                    ← Back to Console
                </button>
            </div>

            {statusMessage && (
                <div className="status-banner">
                    {statusMessage}
                    <button type="button" onClick={() => setStatusMessage(null)}>×</button>
                </div>
            )}

            {!socket.connected && <p className="error">Not connected to server</p>}
            {socket.error && <p className="error">{socket.error}</p>}

            {gmState ? (
                teamTiles.length ? (
                    <div className="submission-layout">
                        <div className="submission-grid" role="list">
                            {teamTiles.map((tile) => {
                                const statusLabel = tile.status === 'graded'
                                    ? 'Graded'
                                    : tile.status === 'in_review'
                                        ? 'Needs review'
                                        : 'Waiting';
                                const submittedAtLabel = tile.submittedAt
                                    ? new Date(tile.submittedAt).toLocaleTimeString()
                                    : null;
                                return (
                                    <button
                                        key={tile.teamId}
                                        type="button"
                                        role="listitem"
                                        className={`submission-tile submission-tile--${tile.status}${selectedTeamId === tile.teamId ? ' active' : ''}`}
                                        onClick={() => setSelectedTeamId(tile.teamId)}
                                    >
                                        <span className="submission-tile-name">{tile.name}</span>
                                        <div className="submission-tile-meta">
                                            <span className="submission-tile-score">Score {tile.score}</span>
                                            {submittedAtLabel && <span className="submission-tile-time">Submitted {submittedAtLabel}</span>}
                                        </div>
                                        <span className={`submission-status submission-status--${tile.status}`}>
                                            {statusLabel}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="submission-detail">
                            {selectedTeamId ? (
                                selectedSubmission ? (
                                    <div className="submission-detail-card">
                                        <header className="submission-detail-header">
                                            <div>
                                                <h4>{selectedTile?.name ?? 'Team'}</h4>
                                                <p>
                                                    {selectedSubmission.createdAt
                                                        ? `Submitted ${new Date(selectedSubmission.createdAt).toLocaleTimeString()}`
                                                        : 'Submission received'}
                                                    {selectedRound ? ` · ${selectedRound.label}` : ''}
                                                </p>
                                            </div>
                                            <div className="submission-detail-meta">
                                                {selectedScoreboardEntry && (
                                                    <span>Score: {selectedScoreboardEntry.score}</span>
                                                )}
                                                {selectedSubmission.wagerAmount != null && (
                                                    <span>Wager: {selectedSubmission.wagerAmount}</span>
                                                )}
                                            </div>
                                        </header>
                                        <div className="submission-answers">
                                            {selectedSubmission.answers.map((answer) => {
                                                const draftStatus = gradeDrafts[selectedSubmission.id]?.[answer.questionId] ?? answer.status;
                                                const question = selectedRound?.questions.find((entry) => entry.id === answer.questionId);
                                                const hasChoices = Boolean(question?.choices && question.choices.length);
                                                return (
                                                    <article key={answer.questionId} className="submission-answer">
                                                        <header className="submission-answer-header">
                                                            <div>
                                                                <span className="submission-answer-number">
                                                                    {question ? `Q${question.order + 1}` : 'Question'}
                                                                </span>
                                                                <h5>{question?.text ?? 'Question prompt unavailable'}</h5>
                                                            </div>
                                                            <div className="submission-answer-meta">
                                                                {answer.pointValue != null && !selectedRound?.isFinal && (
                                                                    <span>Value {answer.pointValue}</span>
                                                                )}
                                                                <span className={`submission-answer-status submission-answer-status--${draftStatus}`}>
                                                                    {draftStatus === 'correct'
                                                                        ? 'Marked correct'
                                                                        : draftStatus === 'incorrect'
                                                                            ? 'Marked incorrect'
                                                                            : 'Awaiting decision'}
                                                                </span>
                                                            </div>
                                                        </header>
                                                        {hasChoices && (
                                                            <ul className="submission-answer-choices">
                                                                {question?.choices?.map((choice, index) => (
                                                                    <li key={index}>{choice}</li>
                                                                ))}
                                                            </ul>
                                                        )}
                                                        <p className="submission-answer-text">{answer.response || '—'}</p>
                                                        <div
                                                            className="grade-toggle"
                                                            role="group"
                                                            aria-label={`Grade ${question?.text ?? 'answer'}`}
                                                        >
                                                            <button
                                                                type="button"
                                                                className={`grade-button grade-button--correct${draftStatus === 'correct' ? ' active' : ''}`}
                                                                onClick={() =>
                                                                    handleGradeChange(
                                                                        selectedSubmission.id,
                                                                        answer.questionId,
                                                                        'correct',
                                                                    )
                                                                }
                                                            >
                                                                Correct
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className={`grade-button grade-button--incorrect${draftStatus === 'incorrect' ? ' active' : ''}`}
                                                                onClick={() =>
                                                                    handleGradeChange(
                                                                        selectedSubmission.id,
                                                                        answer.questionId,
                                                                        'incorrect',
                                                                    )
                                                                }
                                                            >
                                                                Incorrect
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className={`grade-button grade-button--pending${draftStatus === 'pending' ? ' active' : ''}`}
                                                                onClick={() =>
                                                                    handleGradeChange(
                                                                        selectedSubmission.id,
                                                                        answer.questionId,
                                                                        'pending',
                                                                    )
                                                                }
                                                            >
                                                                Reset
                                                            </button>
                                                        </div>
                                                    </article>
                                                );
                                            })}
                                        </div>
                                        <div className="form-actions submission-detail-actions">
                                            <button
                                                type="button"
                                                className="primary"
                                                disabled={working}
                                                onClick={() => handleSubmitGrades(selectedSubmission)}
                                            >
                                                Submit Grades
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="submission-detail-empty">
                                        <h4>{selectedTile?.name ?? 'Team'}</h4>
                                        <p>No submission received for this round.</p>
                                    </div>
                                )
                            ) : (
                                <p className="empty-state">Select a team to review.</p>
                            )}
                        </div>
                    </div>
                ) : (
                    <p className="empty-state">No teams have joined yet.</p>
                )
            ) : (
                <p className="empty-state">Connecting to game...</p>
            )}
        </div>
    );
}

export default GamemasterSubmissionsPage;
