import { useEffect, useMemo, useState } from 'react';
import type { GamemasterGameState, RoundStateView, SubmissionView } from '@shared/types';
import ScoreboardTable from '../components/ScoreboardTable';
import { adjustTeamScore, closeRound, createGame, fetchOpenGame, gradeSubmission, importQuestionSet, openRound, removeTeam, setJoiningOpen } from '../api';
import { useTriviaSocket } from '../hooks/useTriviaSocket';
import { loadHostSession, persistHostSession, type HostSession } from '../hostSession';

type GamemasterSession = HostSession;

type SubmissionStatus = SubmissionView['answers'][number]['status'];

type SubmissionDrafts = Record<string, Record<string, SubmissionStatus>>;

interface TeamAdjustmentDraft {
    amount: string;
    note: string;
}

interface GamemasterPageProps {
    onConnectionStatusChange?: (status: 'online' | 'offline' | 'error' | null) => void;
    onSessionChange?: (state: { gameCode: string; gameTitle: string | null; onSignOut: () => void } | null) => void;
}

const loadSession = loadHostSession;
const persistSession = persistHostSession;

function GamemasterPage({ onConnectionStatusChange, onSessionChange }: GamemasterPageProps): JSX.Element {
    const [session, setSession] = useState<GamemasterSession | null>(() => loadSession());
    const [gameCodeInput, setGameCodeInput] = useState('');
    const [pinInput, setPinInput] = useState('');
    const [joinError, setJoinError] = useState<string | null>(null);
    const [createError, setCreateError] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const [working, setWorking] = useState(false);
    const [creating, setCreating] = useState(false);
    const [importing, setImporting] = useState(false);
    const [gradeDrafts, setGradeDrafts] = useState<SubmissionDrafts>({});
    const [createTitle, setCreateTitle] = useState('');
    const [createCode, setCreateCode] = useState('');
    const [importFile, setImportFile] = useState<File | null>(null);
    const [submissionsFullScreen, setSubmissionsFullScreen] = useState(false);
    const [teamManagementFullScreen, setTeamManagementFullScreen] = useState(false);
    const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
    const [teamAdjustmentDrafts, setTeamAdjustmentDrafts] = useState<Record<string, TeamAdjustmentDraft>>({});
    const [pendingTeamAction, setPendingTeamAction] = useState<string | null>(null);

    useEffect(() => () => {
        onSessionChange?.(null);
        onConnectionStatusChange?.(null);
    }, [onSessionChange, onConnectionStatusChange]);

    const socket = useTriviaSocket(
        session
            ? {
                role: 'gamemaster',
                gameCode: session.gameCode,
                adminSecret: session.adminSecret,
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
        // Prioritize current round, then fall back to latest submission round
        if (gmState.game.currentRoundId) {
            return gmState.game.currentRoundId;
        }
        // If there are wagers but no submissions, use the wager's round
        if (gmState.wagers.length > 0 && gmState.submissions.length === 0) {
            return gmState.wagers[0].roundId;
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

            // For wager rounds, wagers are stored with the linkedRoundId (final round), not the wager round itself
            // So we need to check if team has placed a wager for the linked round
            const wagerRoundTargetId = activeRound?.mode === 'wager' ? activeRound.linkedRoundId : activeRoundId;
            const hasWager = wagerRoundTargetId !== null && 
                wagerRoundTargetId !== undefined &&
                activeRound?.mode === 'wager' && 
                gmState.wagers.some(w => w.teamId === entry.teamId && w.roundId === wagerRoundTargetId);

            const status: 'waiting' | 'in_review' | 'graded' = submission
                ? statuses.every((state) => state === 'correct' || state === 'incorrect')
                    ? 'graded'
                    : 'in_review'
                : hasWager
                    ? 'graded' // Wagers are automatically accepted - nothing to review
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
    }, [gmState, submissionsByTeam, submissionsForActiveRound, gradeDrafts, activeRound, activeRoundId]);

    const hasSubmissions = submissionsForActiveRound.length > 0;

    const clearSession = () => {
        setSession(null);
        setGradeDrafts({});
        persistSession(null);
        setStatusMessage('Cleared gamemaster session.');
    };

    // Notify parent of connection status changes
    useEffect(() => {
        if (!onConnectionStatusChange) {
            return;
        }
        if (socket.error) {
            onConnectionStatusChange('error');
        } else if (socket.connected) {
            onConnectionStatusChange('online');
        } else if (session) {
            onConnectionStatusChange('offline');
        } else {
            onConnectionStatusChange(null);
        }
    }, [socket.connected, socket.error, session, onConnectionStatusChange]);

    // Notify parent of session changes
    useEffect(() => {
        if (!onSessionChange) {
            return;
        }
        if (session && gmState) {
            onSessionChange({
                gameCode: session.gameCode,
                gameTitle: gmState.game.title,
                onSignOut: clearSession,
            });
        } else if (session) {
            onSessionChange({
                gameCode: session.gameCode,
                gameTitle: null,
                onSignOut: clearSession,
            });
        } else {
            onSessionChange(null);
        }
    }, [session, gmState, onSessionChange]);

    // Auto-dismiss toast messages
    useEffect(() => {
        if (!toastMessage) {
            return;
        }
        const timer = setTimeout(() => {
            setToastMessage(null);
        }, 3000);
        return () => clearTimeout(timer);
    }, [toastMessage]);

    // Convert statusMessage to toast
    useEffect(() => {
        if (statusMessage) {
            setToastMessage(statusMessage);
            setStatusMessage(null);
        }
    }, [statusMessage]);

    // Convert errors to toast
    useEffect(() => {
        if (createError) {
            setToastMessage(createError);
        }
    }, [createError]);

    useEffect(() => {
        if (joinError) {
            setToastMessage(joinError);
        }
    }, [joinError]);

    useEffect(() => {
        if (socket.error) {
            setToastMessage(socket.error);
        }
    }, [socket.error]);

    useEffect(() => {
        if (!session) {
            return;
        }
        persistSession(session);
    }, [session]);

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
        if (!hasSubmissions) {
            setSubmissionsFullScreen(false);
        }
    }, [hasSubmissions]);

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

    const scoreboardCount = gmState?.scoreboard.length ?? 0;

    useEffect(() => {
        if (scoreboardCount === 0) {
            setTeamManagementFullScreen(false);
        }
    }, [scoreboardCount]);

    const fullScreenActive = submissionsFullScreen || teamManagementFullScreen;

    useEffect(() => {
        if (!fullScreenActive || typeof document === 'undefined') {
            return;
        }
        const { body } = document;
        const previousOverflow = body.style.overflow;
        body.style.overflow = 'hidden';
        return () => {
            body.style.overflow = previousOverflow;
        };
    }, [fullScreenActive]);

    useEffect(() => {
        if (!fullScreenActive || typeof window === 'undefined') {
            return;
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setSubmissionsFullScreen(false);
                setTeamManagementFullScreen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [fullScreenActive]);

    useEffect(() => {
        if (!gmState) {
            setTeamAdjustmentDrafts({});
            return;
        }
        setTeamAdjustmentDrafts((current) => {
            const allowedIds = new Set(gmState.scoreboard.map((entry) => entry.teamId));
            const next: Record<string, TeamAdjustmentDraft> = {};
            allowedIds.forEach((teamId) => {
                if (current[teamId]) {
                    next[teamId] = current[teamId];
                }
            });
            const currentKeys = Object.keys(current);
            const nextKeys = Object.keys(next);
            if (currentKeys.length === nextKeys.length && nextKeys.every((key) => current[key] === next[key])) {
                return current;
            }
            return next;
        });
    }, [gmState]);

    const handleJoin = async (event: React.FormEvent) => {
        event.preventDefault();
        setJoinError(null);
        setStatusMessage(null);
        if (!pinInput.trim()) {
            setJoinError('Host secret is required.');
            return;
        }
        let code = gameCodeInput.trim().toUpperCase();
        if (!code) {
            try {
                code = (await fetchOpenGame()).game?.code ?? '';
            } catch (error) {
                setJoinError(error instanceof Error ? error.message : 'Unable to find open game.');
                return;
            }
        }
        if (!code) {
            setJoinError('No game is open. Enter an existing game code or create a game.');
            return;
        }
        const next: GamemasterSession = {
            gameCode: code,
            adminSecret: pinInput.trim(),
        };
        setSession(next);
        persistSession(next);
        setStatusMessage('Gamemaster session saved.');
        setGameCodeInput('');
        setPinInput('');
    };

    const handleCreateGame = async (event: React.FormEvent) => {
        event.preventDefault();
        setCreateError(null);
        setStatusMessage(null);
        const trimmedTitle = createTitle.trim();
        const trimmedPin = pinInput.trim();
        const trimmedCode = createCode.trim().toUpperCase();
        const selectedFile = importFile;
        const selectedFileName = selectedFile?.name ?? '';
        let importPayload: unknown | null = null;

        if (!trimmedTitle || !trimmedPin) {
            setCreateError('Title and host secret are required.');
            return;
        }

        if (selectedFile) {
            try {
                const fileContents = await selectedFile.text();
                importPayload = JSON.parse(fileContents);
            } catch (error) {
                setCreateError('Unable to read import file. Please select a valid JSON file.');
                return;
            }
        }

        try {
            setCreating(true);
            const result = await createGame({
                title: trimmedTitle,
                adminSecret: trimmedPin,
                code: trimmedCode ? trimmedCode : undefined,
            });
            const next: GamemasterSession = {
                gameCode: result.game.code,
                adminSecret: trimmedPin,
            };
            setSession(next);
            persistSession(next);
            setCreateTitle('');
            setCreateCode('');
            let status = `Created game "${result.game.title}" with code ${result.game.code}.`;
            if (importPayload) {
                try {
                    await importQuestionSet(result.game.code, trimmedPin, importPayload);
                    status = `Created game "${result.game.title}" and imported ${selectedFileName || 'question set'}.`;
                    setImportFile(null);
                } catch (error) {
                    const message = error instanceof Error ? error.message : 'Unable to import question set.';
                    setCreateError(`Game created but import failed: ${message}`);
                }
            } else {
                setImportFile(null);
            }
            setStatusMessage(status);
        } catch (error) {
            setCreateError(error instanceof Error ? error.message : 'Unable to create game.');
        } finally {
            setCreating(false);
        }
    };

    const handleRoundAction = async (round: RoundStateView, action: 'open' | 'close') => {
        if (!session) {
            return;
        }
        try {
            setWorking(true);
            if (action === 'open') {
                await openRound(session.gameCode, session.adminSecret, round.id);
                setStatusMessage(`Round "${round.label}" opened.`);
            } else {
                await closeRound(session.gameCode, session.adminSecret, round.id);
                setStatusMessage(`Round "${round.label}" closed.`);
            }
        } catch (error) {
            setStatusMessage(error instanceof Error ? error.message : 'Unable to update round.');
        } finally {
            setWorking(false);
        }
    };

    const handleImport = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!session || !importFile) return;
        if (gmState?.rounds.length && !window.confirm('Replace all questions and reset scores, answers, and wagers for this game?')) return;
        setWorking(true);
        setImporting(true);
        setCreateError(null);
        try {
            const payload: unknown = JSON.parse(await importFile.text());
            await importQuestionSet(session.gameCode, session.adminSecret, payload);
            setGradeDrafts({});
            setImportFile(null);
            setStatusMessage('Question set imported. Ready to open the first round.');
        } catch (error) {
            setCreateError(error instanceof Error ? error.message : 'Unable to import question set.');
        } finally {
            setWorking(false);
            setImporting(false);
        }
    };

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
        if (!session) {
            return;
        }
        const draft = gradeDrafts[submission.id];
        if (!draft) {
            setStatusMessage('No grades selected for this submission.');
            return;
        }

        try {
            setWorking(true);
            await gradeSubmission(session.gameCode, session.adminSecret, submission.id, submission.answers.map((answer) => ({
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

    const getTeamAdjustmentDraft = (teamId: string): TeamAdjustmentDraft => teamAdjustmentDrafts[teamId] ?? { amount: '', note: '' };

    const updateTeamAdjustmentDraft = (teamId: string, field: keyof TeamAdjustmentDraft, value: string) => {
        setTeamAdjustmentDrafts((current) => {
            const existing = current[teamId] ?? { amount: '', note: '' };
            return {
                ...current,
                [teamId]: {
                    ...existing,
                    [field]: value,
                },
            };
        });
    };

    const handleApplyAdjustment = async (teamId: string, teamName: string) => {
        if (!session) {
            setStatusMessage('Connect with your host secret to manage teams.');
            return;
        }
        const draft = getTeamAdjustmentDraft(teamId);
        const parsed = Number(draft.amount);
        if (!Number.isFinite(parsed) || parsed === 0) {
            setStatusMessage('Enter a non-zero number of points to adjust.');
            return;
        }
        const actionKey = `${teamId}:adjust`;
        setPendingTeamAction(actionKey);
        try {
            const result = await adjustTeamScore(session.gameCode, session.adminSecret, teamId, parsed, draft.note.trim() ? draft.note.trim() : undefined);
            const verb = result.delta > 0 ? 'Added' : 'Removed';
            const absolute = Math.abs(result.delta);
            setStatusMessage(`${verb} ${absolute} point${absolute === 1 ? '' : 's'} for ${teamName}.`);
            setTeamAdjustmentDrafts((current) => {
                const next = { ...current };
                delete next[teamId];
                return next;
            });
        } catch (error) {
            setStatusMessage(error instanceof Error ? error.message : 'Unable to adjust team score.');
        } finally {
            setPendingTeamAction(null);
        }
    };

    const handleRemoveTeam = async (teamId: string, teamName: string) => {
        if (!session) {
            setStatusMessage('Connect with your host secret to manage teams.');
            return;
        }
        const confirmed = window.confirm(`Remove ${teamName} from the game? Their submissions and wagers will be deleted.`);
        if (!confirmed) {
            return;
        }
        const actionKey = `${teamId}:remove`;
        setPendingTeamAction(actionKey);
        try {
            await removeTeam(session.gameCode, session.adminSecret, teamId);
            setStatusMessage(`Removed ${teamName} from the game.`);
            setTeamAdjustmentDrafts((current) => {
                const next = { ...current };
                delete next[teamId];
                return next;
            });
            setSelectedTeamId((current) => (current === teamId ? null : current));
        } catch (error) {
            setStatusMessage(error instanceof Error ? error.message : 'Unable to remove team.');
        } finally {
            setPendingTeamAction(null);
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

    const currentRound = gmState?.rounds.find((round) => round.id === gmState.game.currentRoundId) ?? null;
    const scoreboardDisplayUrl = session
        ? `/scoreboard?game=${encodeURIComponent(session.gameCode)}`
        : '/scoreboard';
    const handleExitFullScreen = () => {
        setSubmissionsFullScreen(false);
        setTeamManagementFullScreen(false);
    };

    return (
        <div className="page gamemaster-page">
            {toastMessage && (
                <div className="toast-notification" role="status">
                    {toastMessage}
                </div>
            )}
            {fullScreenActive && (
                <div
                    className="fullscreen-backdrop"
                    role="presentation"
                    onClick={handleExitFullScreen}
                />
            )}
            <h2>Gamemaster Console</h2>
            {!session && (
                <section className="panel">
                    <label className="field">
                        <span>Host secret</span>
                        <input type="password" value={pinInput} onChange={(event) => setPinInput(event.target.value)}
                            autoComplete="current-password" placeholder="The secret configured on your server" />
                    </label>
                    <p className="panel-subhead">One secret for all host tools. Players never need it.</p>
                </section>
            )}
            {session && socket.error && (
                <section className="panel" role="alert">
                    <p className="error">{socket.error}</p>
                    <button type="button" onClick={clearSession}>Sign out and reconnect</button>
                </section>
            )}
            {gmState && session && (
                <section className="panel event-controls">
                    <div>
                        <h3>{gmState.game.joiningOpen ? 'Team joining is open' : 'Team joining is closed'}</h3>
                        <p className="panel-subhead">Teams visit {window.location.origin} and enter a team name.</p>
                        <p>{scoreboardCount} team{scoreboardCount === 1 ? '' : 's'} joined</p>
                    </div>
                    <button type="button" disabled={working || !socket.connected} onClick={async () => {
                        setWorking(true);
                        try {
                            await setJoiningOpen(session.gameCode, session.adminSecret, !gmState.game.joiningOpen);
                        } catch (error) {
                            setStatusMessage(error instanceof Error ? error.message : 'Unable to update joining.');
                        } finally {
                            setWorking(false);
                        }
                    }}>{gmState.game.joiningOpen ? 'Close joining' : 'Open joining'}</button>
                    <a className="ghost-link" href={scoreboardDisplayUrl} target="_blank" rel="noreferrer">Open projector scoreboard</a>
                </section>
            )}
            {session && (
                <section className="panel">
                    <h3>{gmState?.rounds.length ? 'Replace question set' : 'Import your questions'}</h3>
                    <form className="join-form" onSubmit={handleImport}>
                        <label className="field">
                            <span>Question set (JSON)</span>
                            <input type="file" accept=".json,application/json" required
                                onChange={(event) => setImportFile(event.target.files?.[0] ?? null)} />
                        </label>
                        {createError && <p className="error" role="alert">{createError}</p>}
                        <button type="submit" disabled={working || !importFile || !socket.connected}>
                            {importing ? 'Importing...' : 'Import Questions'}
                        </button>
                    </form>
                </section>
            )}
            <div className="grid">
                {!session && (
                    <>
                        <section className="panel">
                            <h3>Create Game</h3>
                            <form onSubmit={handleCreateGame} className="join-form">
                                <label className="field">
                                    <span>Title</span>
                                    <input
                                        value={createTitle}
                                        onChange={(event) => setCreateTitle(event.target.value)}
                                        placeholder="Trivia Night"
                                        maxLength={120}
                                        required
                                    />
                                </label>
                                <label className="field">
                                    <span>Custom Code (optional)</span>
                                    <input
                                        value={createCode}
                                        onChange={(event) => setCreateCode(event.target.value.toUpperCase())}
                                        placeholder="ABCDE"
                                        maxLength={6}
                                        autoComplete="off"
                                    />
                                </label>
                                <label className="field">
                                    <span>Import Questions (optional)</span>
                                    <input
                                        type="file"
                                        accept=".json,application/json"
                                        onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
                                    />
                                    {importFile && (
                                        <div className="field-hint">
                                            <span>Selected file: {importFile.name}</span>
                                            <button
                                                type="button"
                                                className="ghost-button ghost-button--sm"
                                                onClick={() => setImportFile(null)}
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    )}
                                </label>
                                {createError && <p className="error">{createError}</p>}
                                <button type="submit" className="primary" disabled={creating}>
                                    {creating ? 'Creating…' : 'Create & Connect'}
                                </button>
                            </form>
                        </section>

                        <section className="panel">
                            <h3>Resume a Game</h3>
                            <form onSubmit={handleJoin} className="join-form">
                                <label className="field">
                                    <span>Game Code (optional if joining is open)</span>
                                    <input
                                        value={gameCodeInput}
                                        onChange={(event) => setGameCodeInput(event.target.value.toUpperCase())}
                                        placeholder="ABCDE"
                                        maxLength={6}
                                        autoComplete="off"
                                    />
                                </label>
                                {joinError && <p className="error">{joinError}</p>}
                                <button type="submit" className="primary">
                                    Connect
                                </button>
                            </form>
                        </section>
                    </>
                )}

                <section className="panel">
                    <h3>Rounds</h3>
                    {gmState ? (
                        <ul className="round-list">
                            {gmState.rounds.map((round) => {
                                const isCurrent = gmState.game.currentRoundId === round.id;
                                const modeLabel = round.mode === 'wager' ? 'Wager' : round.mode === 'final' ? 'Final' : 'Standard';
                                return (
                                    <li key={round.id} className={isCurrent ? 'active' : undefined}>
                                        <div className="round-summary">
                                            <strong>{round.label}</strong>
                                            <span>Status: {round.status}</span>
                                            <span>Type: {modeLabel}</span>
                                            <span>Questions: {round.questions.length}</span>
                                            {round.timeLimitSeconds && <span>Timer: {round.timeLimitSeconds}s</span>}
                                        </div>
                                        <div className="round-actions">
                                            <button
                                                type="button"
                                                disabled={working || !socket.connected || round.status === 'open'}
                                                onClick={() => handleRoundAction(round, 'open')}
                                            >
                                                Open
                                            </button>
                                            <button
                                                type="button"
                                                disabled={working || !socket.connected || round.status !== 'open'}
                                                onClick={() => handleRoundAction(round, 'close')}
                                            >
                                                Close
                                            </button>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <p className="empty-state">Connect with your host secret to manage rounds.</p>
                    )}
                </section>

                {currentRound && (
                    <section className="panel">
                        <h3>Current Round Details</h3>
                        <p>
                            <strong>Label:</strong> {currentRound.label}
                        </p>
                        <p>
                            <strong>Status:</strong> {currentRound.status}
                        </p>
                        <p>
                            <strong>Point Options:</strong> {currentRound.pointOptions.join(', ')}
                        </p>
                        {currentRound.timeLimitSeconds && currentRound.openedAt && (
                            <p>
                                <strong>Time Remaining:</strong>{' '}
                                <TimeRemaining
                                    openedAt={currentRound.openedAt}
                                    timeLimitSeconds={currentRound.timeLimitSeconds}
                                    status={currentRound.status}
                                />
                            </p>
                        )}
                        <ul className="question-list compact">
                            {currentRound.questions.map((question) => (
                                <li key={question.id}>
                                    <strong>Q{question.order + 1}:</strong> {question.text}
                                    {question.choices && question.choices.length > 0 && (
                                        <ul className="choices-preview">
                                            {question.choices.map((choice, index) => (
                                                <li key={index}>{choice}</li>
                                            ))}
                                        </ul>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {gmState && activeRound && (
                    <section className="panel">
                        <div className="panel-header">
                            <h3>Submission Overview – {activeRound.label}</h3>
                            <div className="panel-actions">
                                <a
                                    className="ghost-link"
                                    href={`/gamemaster/submissions?game=${encodeURIComponent(session?.gameCode ?? '')}`}
                                >
                                    Manage Submissions →
                                </a>
                            </div>
                        </div>
                        {teamTiles.length ? (
                            <div className="submission-overview">
                                <div className="submission-stats">
                                    <div className="stat">
                                        <span className="stat-value">{teamTiles.filter(t => t.status === 'graded').length}</span>
                                        <span className="stat-label">Graded</span>
                                    </div>
                                    <div className="stat">
                                        <span className="stat-value">{teamTiles.filter(t => t.status === 'in_review').length}</span>
                                        <span className="stat-label">Needs Review</span>
                                    </div>
                                    <div className="stat">
                                        <span className="stat-value">{teamTiles.filter(t => t.status === 'waiting').length}</span>
                                        <span className="stat-label">Waiting</span>
                                    </div>
                                    {activeRound.mode === 'wager' && (
                                        <div className="stat">
                                            <span className="stat-value">
                                                {gmState.wagers.filter(w => w.roundId === activeRound.linkedRoundId).length}
                                            </span>
                                            <span className="stat-label">Wagers Placed</span>
                                        </div>
                                    )}
                                </div>
                                <ul className="submission-summary-list">
                                    {teamTiles.map((tile) => {
                                        const statusLabel = tile.status === 'graded'
                                            ? 'Graded'
                                            : tile.status === 'in_review'
                                                ? 'Needs review'
                                                : 'Waiting';
                                        const submittedAtLabel = tile.submittedAt
                                            ? new Date(tile.submittedAt).toLocaleTimeString()
                                            : null;
                                        // Wagers are stored with the linkedRoundId (final round) for wager rounds
                                        const wagerTargetRoundId = activeRound.mode === 'wager' ? activeRound.linkedRoundId : activeRoundId;
                                        const wager = wagerTargetRoundId 
                                            ? gmState.wagers.find(w => w.teamId === tile.teamId && w.roundId === wagerTargetRoundId)
                                            : null;
                                        return (
                                            <li key={tile.teamId} className={`submission-summary-item submission-summary-item--${tile.status}`}>
                                                <span className="submission-summary-name">{tile.name}</span>
                                                {wager && (
                                                    <span className="submission-summary-wager">Wager: {wager.amount}</span>
                                                )}
                                                <span className="submission-summary-time">{submittedAtLabel ?? '—'}</span>
                                                <span className={`submission-summary-status submission-summary-status--${tile.status}`}>
                                                    {statusLabel}
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        ) : (
                            <p className="empty-state">No teams have joined yet.</p>
                        )}
                    </section>
                )}

                <section className="panel">
                    <div className="panel-header">
                        <h3>Team Management</h3>
                        <div className="panel-actions">
                            <a
                                className="ghost-link"
                                href={`/gamemaster/teams?game=${encodeURIComponent(session?.gameCode ?? '')}`}
                            >
                                Manage Teams →
                            </a>
                        </div>
                    </div>
                    {gmState ? (
                        gmState.scoreboard.length ? (
                            <p className="panel-hint">
                                {gmState.scoreboard.length} team{gmState.scoreboard.length === 1 ? '' : 's'} registered.
                                Use the team management page to apply score adjustments or remove teams.
                            </p>
                        ) : (
                            <p className="empty-state">No teams to manage yet.</p>
                        )
                    ) : (
                        <p className="empty-state">Connect with your host secret to manage teams.</p>
                    )}
                </section>

                <section className="panel">
                    <div className="panel-header">
                        <h3>Scoreboard</h3>
                        <div className="panel-actions">
                            <a className="ghost-link" href={scoreboardDisplayUrl} target="_blank" rel="noreferrer">
                                Open Display
                            </a>
                        </div>
                    </div>
                    <ScoreboardTable scores={gmState?.scoreboard ?? []} />
                </section>

            </div>
        </div>
    );
}

// Time Remaining Component
function TimeRemaining({ openedAt, timeLimitSeconds, status }: { openedAt: string; timeLimitSeconds: number; status: string }): JSX.Element {
    const [timeLeft, setTimeLeft] = useState<number | null>(null);

    useEffect(() => {
        if (status !== 'open') {
            setTimeLeft(null);
            return;
        }

        const calculateTimeLeft = () => {
            const opened = new Date(openedAt).getTime();
            const now = Date.now();
            const elapsed = Math.floor((now - opened) / 1000);
            const remaining = Math.max(0, timeLimitSeconds - elapsed);
            return remaining;
        };

        setTimeLeft(calculateTimeLeft());

        const interval = setInterval(() => {
            setTimeLeft(calculateTimeLeft());
        }, 1000);

        return () => clearInterval(interval);
    }, [openedAt, timeLimitSeconds, status]);

    if (timeLeft === null) {
        return <span>—</span>;
    }

    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    const isLow = timeLeft <= 60;

    return (
        <span className={isLow ? 'time-remaining time-remaining--low' : 'time-remaining'}>
            {minutes}:{seconds.toString().padStart(2, '0')}
        </span>
    );
}

export default GamemasterPage;
