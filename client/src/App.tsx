import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import TeamPage from './pages/TeamPage';
import GamemasterPage from './pages/GamemasterPage';
import GamemasterSubmissionsPage from './pages/GamemasterSubmissionsPage';
import GamemasterTeamsPage from './pages/GamemasterTeamsPage';
import ScoreboardPage from './pages/ScoreboardPage';
import LandingPage from './pages/LandingPage';

type ConnectionStatus = 'online' | 'offline' | 'error' | null;

interface TeamNavState {
    teamName: string;
    gameTitle: string | null;
    onLeave: () => void;
}

interface GamemasterNavState {
    gameCode: string;
    gameTitle: string | null;
    onSignOut: () => void;
}

function AppShell(): JSX.Element {
    const location = useLocation();
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(null);
    const [teamNavState, setTeamNavState] = useState<TeamNavState | null>(null);
    const [gamemasterNavState, setGamemasterNavState] = useState<GamemasterNavState | null>(null);
    const scoreboardDisplayMode = location.pathname === '/scoreboard';
    const shellClassName = scoreboardDisplayMode ? 'app-shell scoreboard-display-mode' : 'app-shell';
    const headerTitle = gamemasterNavState?.gameTitle ?? teamNavState?.gameTitle ?? 'Trivia Control Center';

    useEffect(() => {
        const nextTitle = gamemasterNavState?.gameTitle ?? teamNavState?.gameTitle ?? 'Holiday Trivia';
        if (typeof document !== 'undefined' && document.title !== nextTitle) {
            document.title = nextTitle;
        }
    }, [teamNavState?.gameTitle, gamemasterNavState?.gameTitle]);

    const renderConnectionStatus = () => {
        if (!connectionStatus) {
            return null;
        }
        const label = connectionStatus === 'online' ? 'Connected' : connectionStatus === 'error' ? 'Connection error' : 'Connecting…';
        return <span className={`connection-indicator header ${connectionStatus}`}>{label}</span>;
    };

    const renderTeamNav = () => {
        if (!teamNavState) {
            return null;
        }
        return (
            <div className="header-team-controls">
                <span className="team-chip">{teamNavState.teamName}</span>
                <button type="button" className="ghost-button ghost-button--sm" onClick={teamNavState.onLeave}>
                    Leave Game
                </button>
            </div>
        );
    };

    const renderGamemasterNav = () => {
        if (!gamemasterNavState) {
            return null;
        }
        return (
            <div className="header-team-controls">
                <span className="team-chip">Game: {gamemasterNavState.gameCode}</span>
                <button type="button" className="ghost-button ghost-button--sm" onClick={gamemasterNavState.onSignOut}>
                    Sign Out
                </button>
            </div>
        );
    };

    return (
        <div className={shellClassName}>
            {!scoreboardDisplayMode && (
                <header className="app-header">
                    <div className="app-header-left">
                        <h1>{headerTitle}</h1>
                    </div>
                    <div className="app-header-controls">
                        {renderConnectionStatus()}
                        {renderTeamNav()}
                        {renderGamemasterNav()}
                    </div>
                </header>
            )}
            <main className="app-main" id="main-content">
                <Routes>
                    <Route
                        path="/"
                        element={(
                            <TeamPage
                                onConnectionStatusChange={setConnectionStatus}
                                onSessionChange={setTeamNavState}
                            />
                        )}
                    />
                    <Route
                        path="/team"
                        element={(
                            <TeamPage
                                onConnectionStatusChange={setConnectionStatus}
                                onSessionChange={setTeamNavState}
                            />
                        )}
                    />
                    <Route path="/gamemaster" element={(
                        <GamemasterPage
                            onConnectionStatusChange={setConnectionStatus}
                            onSessionChange={setGamemasterNavState}
                        />
                    )} />
                    <Route path="/gamemaster/submissions" element={<GamemasterSubmissionsPage />} />
                    <Route path="/gamemaster/teams" element={<GamemasterTeamsPage />} />
                    <Route path="/scoreboard" element={<ScoreboardPage />} />
                    <Route path="/welcome" element={<LandingPage />} />
                    <Route path="*" element={<section className="panel page"><h2>Page not found</h2><Link to="/">Back to trivia</Link></section>} />
                </Routes>
            </main>
            {!scoreboardDisplayMode && (
                <footer className="app-footer">
                    <Link to="/">Play</Link>
                    <Link to="/scoreboard">Scoreboard</Link>
                    <Link to="/gamemaster">Host tools</Link>
                </footer>
            )}
        </div>
    );
}

function App(): JSX.Element {
    return (
        <BrowserRouter>
            <AppShell />
        </BrowserRouter>
    );
}

export default App;
