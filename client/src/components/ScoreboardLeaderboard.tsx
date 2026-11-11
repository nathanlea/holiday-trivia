import type { TeamScore } from '@shared/types';

function ScoreboardLeaderboard({ scores }: { scores: TeamScore[] }): JSX.Element {
    if (!scores.length) {
        return <p className="empty-state">No teams have joined yet. Your spot on the nice list is waiting!</p>;
    }

    const layout = scores.length > 16 ? ' holiday-leaderboard--wide'
        : scores.length > 8 ? ' holiday-leaderboard--split' : '';

    return (
        <ol className={`holiday-leaderboard${layout}`} aria-label="Team rankings">
            {scores.map((team) => {
                const rank = scores.findIndex((entry) => entry.score === team.score) + 1;
                return (
                    <li key={team.teamId} className="holiday-standing" data-rank={rank} value={rank}>
                        <span className="holiday-standing-rank" aria-label={`Rank ${rank}`}>{rank}</span>
                        <span className="holiday-standing-name">{team.name}</span>
                        <span className="holiday-standing-score">
                            <strong>{team.score.toLocaleString()}</strong>
                            <span>points</span>
                        </span>
                    </li>
                );
            })}
        </ol>
    );
}

export default ScoreboardLeaderboard;
