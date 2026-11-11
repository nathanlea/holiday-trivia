import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ScoreboardLeaderboard from './ScoreboardLeaderboard';

describe('Christmas leaderboard', () => {
    it('preserves tied ranks and names in accessible rankings', () => {
        const markup = renderToStaticMarkup(<ScoreboardLeaderboard scores={[
            { teamId: 'a', name: 'Sleigh Squad', score: 20 },
            { teamId: 'b', name: 'Snow Patrol', score: 20 },
            { teamId: 'c', name: 'Team Tinsel', score: 10 },
        ]} />);
        expect(markup.match(/aria-label="Rank 1"/g)).toHaveLength(2);
        expect(markup).toContain('aria-label="Rank 3"');
        expect(markup).toContain('Sleigh Squad');
        expect(markup).toContain('aria-label="Team rankings"');
    });

    it('shows all 25 teams and chooses the projector layout without hiding lower ranks', () => {
        const markup = renderToStaticMarkup(<ScoreboardLeaderboard scores={Array.from({ length: 25 }, (_, index) => ({
            teamId: `${index}`, name: `Christmas Team ${index + 1}`, score: 100 - index,
        }))} />);
        expect(markup.match(/class="holiday-standing"/g)).toHaveLength(25);
        expect(markup).toContain('holiday-leaderboard--wide');
        expect(markup).toContain('Christmas Team 25');
    });

    it('explains an empty scoreboard', () => {
        expect(renderToStaticMarkup(<ScoreboardLeaderboard scores={[]} />)).toContain('No teams have joined yet.');
    });
});
