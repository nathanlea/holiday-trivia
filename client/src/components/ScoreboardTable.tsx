import type { TeamScore } from '@shared/types';

interface ScoreboardTableProps {
    scores: TeamScore[];
    highlightTeamId?: string;
}

function ScoreboardTable({ scores, highlightTeamId }: ScoreboardTableProps): JSX.Element {
    if (!scores.length) {
        return <p className="empty-state">No teams have joined yet.</p>;
    }

    return (
        <table className="scoreboard-table" aria-label="Team rankings">
            <thead>
                <tr>
                    <th>Rank</th>
                    <th>Team</th>
                    <th>Score</th>
                </tr>
            </thead>
            <tbody>
                {scores.map((score) => {
                    const isHighlight = highlightTeamId === score.teamId;
                    return (
                        <tr key={score.teamId} className={isHighlight ? 'highlight' : undefined}>
                            <td>{scores.findIndex((entry) => entry.score === score.score) + 1}</td>
                            <td>{score.name}</td>
                            <td>{score.score}</td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}

export default ScoreboardTable;
