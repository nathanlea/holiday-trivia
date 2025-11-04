import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ScoreboardGameState } from '@shared/types';
import ScoreboardTable from '../components/ScoreboardTable';
import { useTriviaSocket } from '../hooks/useTriviaSocket';

interface ScoreboardSession {
    gameCode: string;
    pin: string;
}

const STORAGE_KEY = 'trivia.scoreboard.session.v1';

function loadSession(): ScoreboardSession | null {
    if (typeof window === 'undefined') {
        return null;
    }
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return null;
        }
        return JSON.parse(raw) as ScoreboardSession;
    } catch (error) {
        console.warn('Unable to parse scoreboard session', error);
        return null;
    }
}

function persistSession(session: ScoreboardSession | null): void {
    if (typeof window === 'undefined') {
        return;
    }
    if (!session) {
        window.localStorage.removeItem(STORAGE_KEY);
        return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function ScoreboardPage(): JSX.Element {
    const [searchParams] = useSearchParams();
    const queryGame = searchParams.get('game');
    const queryPin = searchParams.get('pin');
    const normalizedGameParam = queryGame?.trim().toUpperCase() ?? null;
    const normalizedPinParam = queryPin?.trim() ?? null;
    const displayMode = Boolean(normalizedGameParam && normalizedPinParam);

    const [session, setSession] = useState<ScoreboardSession | null>(() => loadSession());
    const [gameCodeInput, setGameCodeInput] = useState('');
    const [pinInput, setPinInput] = useState('');
    const [joinError, setJoinError] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    const socket = useTriviaSocket(
        session
            ? {
                role: 'scoreboard',
                gameCode: session.gameCode,
                pin: session.pin,
            }
            : null,
    );

    const scoreboardState: ScoreboardGameState | null = useMemo(() => {
        if (socket.state?.role === 'scoreboard') {
            return socket.state;
        }
        return null;
    }, [socket.state]);

    const activeRoundLabel = useMemo(() => {
        if (!scoreboardState?.game.currentRoundId) {
            return null;
        }
        const round = scoreboardState.rounds.find((entry) => entry.id === scoreboardState.game.currentRoundId);
        return round?.label ?? null;
    }, [scoreboardState]);

    useEffect(() => {
        if (!session) {
            return;
        }
        persistSession(session);
    }, [session]);

    useEffect(() => {
        if (!displayMode || !normalizedGameParam || !normalizedPinParam) {
            return;
        }
        setSession((current) => {
            if (current && current.gameCode === normalizedGameParam && current.pin === normalizedPinParam) {
                return current;
            }
            const next: ScoreboardSession = {
                gameCode: normalizedGameParam,
                pin: normalizedPinParam,
            };
            persistSession(next);
            return next;
        });
    }, [displayMode, normalizedGameParam, normalizedPinParam]);

    useEffect(() => {
        if (displayMode) {
            setJoinError(null);
            setStatusMessage(null);
        }
    }, [displayMode]);

    const handleJoin = (event: React.FormEvent) => {
        event.preventDefault();
        setJoinError(null);
        if (!gameCodeInput.trim() || !pinInput.trim()) {
            setJoinError('Game code and PIN are required.');
            return;
        }
        const next: ScoreboardSession = {
            gameCode: gameCodeInput.trim().toUpperCase(),
            pin: pinInput.trim(),
        };
        setSession(next);
        persistSession(next);
        setStatusMessage('Scoreboard connected.');
        setGameCodeInput('');
        setPinInput('');
    };

    const clearSession = () => {
        setSession(null);
        persistSession(null);
        setStatusMessage('Cleared scoreboard session.');
    };

    const displayGameCode = normalizedGameParam ?? session?.gameCode ?? scoreboardState?.game.code ?? null;
    const scoreboardTitle = scoreboardState?.game.title ?? (displayGameCode ? `Game ${displayGameCode}` : 'Live Scoreboard');
    const scoreboardScores = scoreboardState?.scoreboard ?? [];
    const projectorNote = scoreboardState?.waitingMessage ?? (socket.connected ? 'Awaiting scores…' : 'Connecting to game…');
    const lastUpdatedLabel = scoreboardState?.lastUpdated
        ? `Updated ${new Date(scoreboardState.lastUpdated).toLocaleTimeString()}`
        : 'Waiting for first update';
    const connectionIndicatorStatus = socket.error ? 'error' : socket.connected ? 'online' : 'offline';
    const connectionIndicatorLabel = socket.error ? 'Connection error' : socket.connected ? 'Live' : 'Connecting…';

    if (displayMode) {
        return (
            <div className="scoreboard-display">
                <div className="scoreboard-display-header">
                    <h1>{scoreboardTitle}</h1>
                    {activeRoundLabel && <p className="scoreboard-display-round">{activeRoundLabel}</p>}
                    {projectorNote && <p className="scoreboard-display-note">{projectorNote}</p>}
                </div>
                <div className="scoreboard-display-table">
                    <ScoreboardTable scores={scoreboardScores} />
                </div>
                <div className="scoreboard-display-footer">
                    <span className={`connection-indicator ${connectionIndicatorStatus}`}>{connectionIndicatorLabel}</span>
                    <span className="scoreboard-display-updated">{lastUpdatedLabel}</span>
                </div>
            </div>
        );
    }

    return (
        <div className="page scoreboard-page">
            <h2>Scoreboard Display</h2>
            <div className="grid">
                <section className="panel">
                    <h3>Connection</h3>
                    <p className={`connection-indicator ${socket.connected ? 'online' : 'offline'}`}>
                        {socket.connected ? 'Connected' : session ? 'Connecting…' : 'Not connected'}
                    </p>
                    {socket.error && <p className="error">{socket.error}</p>}
                    {statusMessage && <p className="status">{statusMessage}</p>}
                </section>

                <section className="panel">
                    <h3>Authenticate</h3>
                    {session ? (
                        <div className="session-summary">
                            <p>
                                <strong>Game:</strong> {session.gameCode}
                            </p>
                            <button type="button" onClick={clearSession}>
                                Disconnect
                            </button>
                        </div>
                    ) : (
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
                                <span>PIN</span>
                                <input
                                    value={pinInput}
                                    onChange={(event) => setPinInput(event.target.value)}
                                    placeholder="123456"
                                    required
                                    autoComplete="off"
                                />
                            </label>
                            {joinError && <p className="error">{joinError}</p>}
                            <button type="submit" className="primary">
                                Connect
                            </button>
                        </form>
                    )}
                </section>

                <section className="panel full-bleed">
                    <h3>Live Scores</h3>
                    <ScoreboardTable scores={scoreboardScores} />
                    {scoreboardState ? (
                        <p className="panel-subhead">
                            Round status: {scoreboardState.currentRoundStatus}{' '}
                            {scoreboardState.waitingMessage ? `– ${scoreboardState.waitingMessage}` : ''}
                        </p>
                    ) : (
                        <p className="panel-subhead">Connect to begin receiving live scores.</p>
                    )}
                </section>
            </div>
        </div>
    );
}

export default ScoreboardPage;
