import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import NumericGradeComparison from './NumericGradeComparison';

const config = {
    correctAnswer: 100,
    ranges: [{ maxPercentOff: 5, pointsPercent: 100 }, { maxPercentOff: 10, pointsPercent: 50 }],
    wagerLossThresholds: [{ maxPercentOff: 20, wagerLossPercent: 0 }],
};

describe('Numeric grading transparency', () => {
    it('shows expected answer, difference, automatic points and host overrides', () => {
        const markup = renderToStaticMarkup(<NumericGradeComparison
            response="110" config={config} assignedPoints={20} isFinal awardedPoints={20} status="correct"
        />);
        expect(markup).toContain('Expected answer: 100');
        expect(markup).toContain('Difference: 10 above expected');
        expect(markup).toContain('10% off');
        expect(markup).toContain('Automatic score: +10 pts');
        expect(markup).toContain('Saved score: +20 pts');
        expect(markup).toContain('Host override applied.');
    });

    it('shows blanks as incorrect, not numeric zero', () => {
        const markup = renderToStaticMarkup(<NumericGradeComparison
            response="" config={{ ...config, correctAnswer: 0 }} assignedPoints={20} isFinal awardedPoints={-20} status="incorrect"
        />);
        expect(markup).toContain('No answer - counts as incorrect.');
        expect(markup).toContain('Automatic score: -20 pts');
        expect(markup).not.toContain('Exact answer.');
    });

    it('explains a nonzero response when the expected answer is zero', () => {
        const markup = renderToStaticMarkup(<NumericGradeComparison
            response="10" config={{ ...config, correctAnswer: 0 }} assignedPoints={20} isFinal awardedPoints={-20} status="incorrect"
        />);
        expect(markup).toContain('Percentage difference undefined (expected zero)');
        expect(markup).not.toContain('NaN');
    });
});
