import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import type { GamemasterGameState } from '@shared/types';
import { adjustTeamScore, removeTeam } from '../api';
import { useTriviaSocket } from '../hooks/useTriviaSocket';

interface TeamAdjustmentDraft {
    amount: string;
    note: string;
}

function GamemasterTeamsPage(): JSX.Element {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const gameCode = searchParams.get('game');
    const pin = searchParams.get('pin');

    const [teamAdjustmentDrafts, setTeamAdjustmentDrafts] = useState<Record<string, TeamAdjustmentDraft>>({});
    const [pendingTeamAction, setPendingTeamAction] = useState<string | null>(null);
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
        if (!gameCode || !pin) {
            setStatusMessage('Missing game code or PIN.');
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
            const result = await adjustTeamScore(gameCode, pin, teamId, parsed, draft.note.trim() ? draft.note.trim() : undefined);
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
        if (!gameCode || !pin) {
            setStatusMessage('Missing game code or PIN.');
            return;
        }
        const confirmed = window.confirm(`Remove ${teamName} from the game? Their submissions and wagers will be deleted.`);
        if (!confirmed) {
            return;
        }
        const actionKey = `${teamId}:remove`;
        setPendingTeamAction(actionKey);
        try {
            await removeTeam(gameCode, pin, teamId);
            setStatusMessage(`Removed ${teamName} from the game.`);
            setTeamAdjustmentDrafts((current) => {
                const next = { ...current };
                delete next[teamId];
                return next;
            });
        } catch (error) {
            setStatusMessage(error instanceof Error ? error.message : 'Unable to remove team.');
        } finally {
            setPendingTeamAction(null);
        }
    };

    if (!gameCode || !pin) {
        return (
            <div className="page">
                <h2>Manage Teams</h2>
                <p className="error">Missing game code or PIN in URL parameters.</p>
                <button type="button" onClick={() => navigate('/gamemaster')}>
                    Back to Gamemaster Console
                </button>
            </div>
        );
    }

    return (
        <div className="page gamemaster-teams-page">
            <div className="page-header">
                <div>
                    <h2>Team Management</h2>
                    <p className="page-subhead">Award bonuses, apply penalties, or remove teams from the game.</p>
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
                gmState.scoreboard.length ? (
                    <ul className="team-management-list">
                        {gmState.scoreboard.map((entry) => {
                            const draft = getTeamAdjustmentDraft(entry.teamId);
                            const adjustKey = `${entry.teamId}:adjust`;
                            const removeKey = `${entry.teamId}:remove`;
                            const isAdjusting = pendingTeamAction === adjustKey;
                            const isRemoving = pendingTeamAction === removeKey;
                            return (
                                <li key={entry.teamId} className="team-management-item">
                                    <div className="team-management-info">
                                        <h4>{entry.name}</h4>
                                        <span className="team-management-score">Score: {entry.score}</span>
                                    </div>
                                    <div className="team-management-controls">
                                        <div className="team-management-adjust">
                                            <label className="sr-only" htmlFor={`adjust-amount-${entry.teamId}`}>
                                                Point adjustment for {entry.name}
                                            </label>
                                            <input
                                                id={`adjust-amount-${entry.teamId}`}
                                                type="number"
                                                className="team-management-input"
                                                value={draft.amount}
                                                onChange={(event) => updateTeamAdjustmentDraft(entry.teamId, 'amount', event.target.value)}
                                                placeholder="+10"
                                                step="1"
                                            />
                                            <label className="sr-only" htmlFor={`adjust-note-${entry.teamId}`}>
                                                Reason for adjustment for {entry.name}
                                            </label>
                                            <input
                                                id={`adjust-note-${entry.teamId}`}
                                                type="text"
                                                className="team-management-input team-management-input--note"
                                                value={draft.note}
                                                onChange={(event) => updateTeamAdjustmentDraft(entry.teamId, 'note', event.target.value)}
                                                placeholder="Reason (optional)"
                                                maxLength={80}
                                            />
                                            <button
                                                type="button"
                                                className="ghost-button ghost-button--success"
                                                disabled={isAdjusting}
                                                onClick={() => handleApplyAdjustment(entry.teamId, entry.name)}
                                            >
                                                {isAdjusting ? 'Applying…' : 'Apply'}
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            className="ghost-button ghost-button--danger"
                                            disabled={isRemoving}
                                            onClick={() => handleRemoveTeam(entry.teamId, entry.name)}
                                        >
                                            {isRemoving ? 'Removing…' : 'Remove'}
                                        </button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <p className="empty-state">No teams to manage yet.</p>
                )
            ) : (
                <p className="empty-state">Connecting to game...</p>
            )}
        </div>
    );
}

export default GamemasterTeamsPage;
