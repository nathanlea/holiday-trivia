import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ScoreboardTable from './ScoreboardTable';

describe('Scoreboard ranks', () => {
    it('gives equal scores the same rank and skips subsequent places', () => {
        const markup = renderToStaticMarkup(<ScoreboardTable scores={[
            { teamId: '1', name: 'Team A', score: 20 },
            { teamId: '2', name: 'Team B', score: 20 },
            { teamId: '3', name: 'Team C', score: 10 },
        ]} />);
        expect(markup).toContain('<td>1</td><td>Team A</td>');
        expect(markup).toContain('<td>1</td><td>Team B</td>');
        expect(markup).toContain('<td>3</td><td>Team C</td>');
    });

    it('explains an empty scoreboard', () => {
        expect(renderToStaticMarkup(<ScoreboardTable scores={[]} />)).toContain('No teams have joined yet.');
    });
});
