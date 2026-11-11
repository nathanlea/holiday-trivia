import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ScoreboardTable from '../components/ScoreboardTable';
import { fetchOpenGame } from '../api';
import { useTriviaSocket } from '../hooks/useTriviaSocket';

function ScoreboardPage(): JSX.Element {
    const [params] = useSearchParams();
    const queryGame = params.get('game')?.trim().toUpperCase() ?? '';
    const [openGameCode, setOpenGameCode] = useState('');
    const [error, setError] = useState<string | null>(null);
    const gameCode = queryGame || openGameCode;
    useEffect(() => {
        if (queryGame) return;
        let cancelled = false;
        const refresh = async () => {
            try {
                const result = await fetchOpenGame();
                if (!cancelled) {
                    if (result.game) setOpenGameCode(result.game.code);
                    setError(null);
                }
            } catch (error) {
                if (!cancelled) setError(error instanceof Error ? error.message : 'Unable to find game.');
            }
        };
        void refresh();
        const timer = window.setInterval(refresh, 10_000);
        return () => { cancelled = true; window.clearInterval(timer); };
    }, [queryGame]);
    const socket = useTriviaSocket(gameCode ? { role: 'scoreboard', gameCode } : null);
    const state = socket.state?.role === 'scoreboard' ? socket.state : null;
    const activeRound = state?.rounds.find((round) => round.id === state.game.currentRoundId);
    return (
        <div className="scoreboard-display">
            <header className="scoreboard-display-header">
                <h1>{state?.game.title ?? 'Holiday Trivia'}</h1>
                <p className="scoreboard-display-round">{activeRound?.label ?? 'Live leaderboard'}</p>
                <p className="scoreboard-display-note">{state?.waitingMessage ?? (!gameCode ? 'Waiting for the host to open a game.' : 'Welcome, trivia teams!')}</p>
            </header>
            {(error || socket.error) && <p className="error" role="alert">{error ?? socket.error}</p>}
            <div className="scoreboard-display-table">
                <ScoreboardTable scores={state?.scoreboard ?? []} />
            </div>
            <footer className="scoreboard-display-footer">
                <span className={`connection-indicator ${socket.connected ? 'online' : 'offline'}`}>
                    {socket.connected ? 'Live' : gameCode ? 'Reconnecting...' : 'Waiting for game'}
                </span>
                <span>{state ? `Updated ${new Date(state.lastUpdated).toLocaleTimeString()}` : 'Waiting for first update'}</span>
                <Link to="/">Join the game</Link>
            </footer>
        </div>
    );
}

export default ScoreboardPage;
