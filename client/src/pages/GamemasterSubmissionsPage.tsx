import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import type { GamemasterGameState, SubmissionView } from '@shared/types';
import { gradeSubmission } from '../api';
import { useTriviaSocket } from '../hooks/useTriviaSocket';
import { loadHostSession } from '../hostSession';
import NumericGradeComparison from '../components/NumericGradeComparison';

type SubmissionStatus = SubmissionView['answers'][number]['status'];

function GamemasterSubmissionsPage(): JSX.Element {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const gameCode = searchParams.get('game');
    const [hostSession] = useState(loadHostSession);
    const pin = hostSession?.gameCode === gameCode ? hostSession.adminSecret : null;

    const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
    const [working, setWorking] = useState(false);
    const savingRef = useRef(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    const socket = useTriviaSocket(
        gameCode && pin
            ? {
                role: 'gamemaster',
                gameCode,
                adminSecret: pin,
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
                ? submission.answers.map((answer) => answer.status)
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
                const statuses = submission.answers.map((answer) => answer.status);
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
    }, [gmState, submissionsByTeam, submissionsForActiveRound]);

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
        const fallbackTile = pendingTile ?? teamTiles.find((tile) => tile.submissionId !== null) ?? teamTiles[0] ?? null;
        const nextId = fallbackTile?.teamId ?? null;

        if (nextId !== selectedTeamId) {
            setSelectedTeamId(nextId);
        }
    }, [gmState, teamTiles, selectedTeamId]);

    const handleGradeChange = async (submissionId: string, questionId: string, status: SubmissionStatus, awardedPoints?: number) => {
        if (savingRef.current) {
            setStatusMessage('Please wait for the current grade to finish saving.');
            return;
        }
        const submission = gmState?.submissions.find((entry) => entry.id === submissionId);
        const answer = submission?.answers.find((entry) => entry.questionId === questionId);
        const round = gmState?.rounds.find((entry) => entry.id === submission?.roundId);
        if (!gameCode || !pin || !submission || !answer || !round) {
            setStatusMessage('Unable to find this submission. Reconnect before grading.');
            return;
        }
        const fullPoints = round.isFinal ? submission.wagerAmount ?? 0 : answer.pointValue ?? 0;
        const defaultPoints = status === 'correct' ? fullPoints
            : status === 'incorrect' && round.isFinal ? -fullPoints : 0;
        savingRef.current = true;
        try {
            setWorking(true);
            setStatusMessage(`Saving grade for ${submission.teamName}...`);
            await gradeSubmission(gameCode, pin, submissionId, [{
                questionId, status, awardedPoints: awardedPoints ?? defaultPoints,
            }]);
            setStatusMessage(`Grade saved for ${submission.teamName}. Total updated.`);
        } catch (error) {
            setStatusMessage(`Grade not saved. ${error instanceof Error ? error.message : 'Unable to save grade.'} Please retry.`);
        } finally {
            savingRef.current = false;
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
                <p className="error">Sign in on the gamemaster page in this tab first.</p>
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
                    <p className="page-subhead">Each grading action saves immediately and updates the total. Change a grade any time.</p>
                </div>
                <button type="button" className="ghost-button" onClick={() => navigate('/gamemaster')}>
                    ← Back to Console
                </button>
            </div>

            {statusMessage && (
                <div className="status-banner" role="status">
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
                                                const draftStatus = answer.status;
                                                const question = selectedRound?.questions.find((entry) => entry.id === answer.questionId);
                                                const hasChoices = Boolean(question?.choices && question.choices.length);
                                                const fullPoints = selectedRound?.isFinal
                                                    ? selectedSubmission.wagerAmount ?? 0 : answer.pointValue ?? 0;
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
                                                                <span>Awarded {answer.awardedPoints} pts</span>
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
                                                                    <li key={index}>{choice}{question?.correctChoiceIndices?.includes(index) ? ' (correct)' : ''}</li>
                                                                ))}
                                                            </ul>
                                                        )}
                                                        <p className="submission-answer-text">{answer.response || '—'}</p>
                                                        {question?.correctAnswerText && !question.numericConfig && (
                                                            <p className="submission-answer-hint">Correct answer: {question.correctAnswerText}</p>
                                                        )}
                                                        {question?.numericConfig && (
                                                            <NumericGradeComparison
                                                                response={answer.response}
                                                                config={question.numericConfig}
                                                                assignedPoints={fullPoints}
                                                                isFinal={Boolean(selectedRound?.isFinal)}
                                                                awardedPoints={answer.awardedPoints}
                                                                status={answer.status}
                                                            />
                                                        )}
                                                        <fieldset className="grade-controls" disabled={working || !socket.connected}>
                                                            <legend className="sr-only">Grade this answer (saves immediately)</legend>
                                                            <div
                                                                className="grade-toggle"
                                                                role="group"
                                                                aria-label={`Grade ${question?.text ?? 'answer'}`}
                                                            >
                                                                <button
                                                                    type="button"
                                                                    className={`grade-button grade-button--correct${draftStatus === 'correct' && answer.awardedPoints === fullPoints ? ' active' : ''}`}
                                                                    onClick={() =>
                                                                        handleGradeChange(
                                                                            selectedSubmission.id,
                                                                            answer.questionId,
                                                                            'correct',
                                                                            undefined,
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
                                                                            undefined,
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
                                                                            undefined,
                                                                        )
                                                                    }
                                                                >
                                                                    Reset
                                                                </button>
                                                            </div>
                                                            {(() => {
                                                                const pointValue = fullPoints;
                                                                const pts80 = Math.round(pointValue * 0.8);
                                                                const pts50 = Math.round(pointValue * 0.5);
                                                                return (
                                                                    <div className="partial-credit-controls">
                                                                        <span className="partial-credit-label">Partial Credit:</span>
                                                                        <div className="partial-credit-buttons">
                                                                            <button
                                                                                type="button"
                                                                                className={`grade-button grade-button--partial${draftStatus !== 'pending' && answer.awardedPoints === pts80 ? ' active' : ''}`}
                                                                                onClick={() =>
                                                                                    handleGradeChange(
                                                                                        selectedSubmission.id,
                                                                                        answer.questionId,
                                                                                        'correct',
                                                                                        pts80,
                                                                                    )
                                                                                }
                                                                            >
                                                                                80% ({pts80} pts)
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                className={`grade-button grade-button--partial${draftStatus !== 'pending' && answer.awardedPoints === pts50 ? ' active' : ''}`}
                                                                                onClick={() =>
                                                                                    handleGradeChange(
                                                                                        selectedSubmission.id,
                                                                                        answer.questionId,
                                                                                        'correct',
                                                                                        pts50,
                                                                                    )
                                                                                }
                                                                            >
                                                                                50% ({pts50} pts)
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                className="grade-button grade-button--partial"
                                                                                onClick={() => {
                                                                                    const minPoints = selectedRound?.isFinal ? -pointValue : 0;
                                                                                    const customPoints = prompt(`Enter custom points (${minPoints} to ${pointValue}):`, answer.awardedPoints.toString());
                                                                                    if (customPoints !== null) {
                                                                                        const points = Number(customPoints);
                                                                                        if (customPoints.trim() && Number.isFinite(points) && points >= minPoints && points <= pointValue) {
                                                                                            handleGradeChange(
                                                                                                selectedSubmission.id,
                                                                                                answer.questionId,
                                                                                                points > 0 ? 'correct' : 'incorrect',
                                                                                                points,
                                                                                            );
                                                                                        } else {
                                                                                            alert(`Please enter a valid number between ${minPoints} and ${pointValue}`);
                                                                                        }
                                                                                    }
                                                                                }}
                                                                            >
                                                                                Custom
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })()}
                                                        </fieldset>
                                                    </article>
                                                );
                                            })}
                                        </div>
                                        <div className="form-actions submission-detail-actions">
                                            <span role="status">{working ? 'Saving grade...' : 'Grades save automatically.'}</span>
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
