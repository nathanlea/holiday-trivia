import { describe, expect, it } from 'vitest';
import { gradeNumericResponse, numericPercentOff, parseNumericResponse } from '../../../shared/numericScoring';
import type { NumericScoringConfig } from '../../../shared/types';

const config: NumericScoringConfig = {
    correctAnswer: 100,
    ranges: [{ maxPercentOff: 10, pointsPercent: 50 }, { maxPercentOff: 5, pointsPercent: 100 }],
    wagerLossThresholds: [{ maxPercentOff: 20, wagerLossPercent: 0 }],
};

describe('Numeric scoring', () => {
    it.each([
        ['39,006', 39006], [' 0 ', 0], ['-1,234.5', -1234.5], ['.5', 0.5],
        ['', null], [' ', null], ['39,06', null], ['1,2,3', null], ['NaN', null],
        ['Infinity', null], ['0x10', null], ['100 people', null],
    ] as const)('parses %j as %j', (response, expected) => {
        expect(parseNumericResponse(response)).toBe(expected);
    });

    it.each([
        ['100', 20], ['105', 20], ['95', 20], ['105.0001', 10],
        ['110', 10], ['90', 10], ['110.0001', 0],
        ['120', 0], ['80', 0], ['120.0001', -20], ['79.9999', -20],
        ['', -20], ['   ', -20],
    ] as const)('awards %j a %j-point wager change', (response, expected) => {
        expect(gradeNumericResponse(response, config, 20, true).awardedPoints).toBe(expected);
    });

    it('distinguishes blank and nonzero answers from an exact numeric zero', () => {
        const zero = { ...config, correctAnswer: 0 };
        expect(numericPercentOff(0, 0)).toBe(0);
        expect(numericPercentOff(1, 0)).toBe(Infinity);
        expect(gradeNumericResponse('0', zero, 10, false)).toEqual({ status: 'correct', awardedPoints: 10 });
        expect(gradeNumericResponse('', zero, 10, false)).toEqual({ status: 'incorrect', awardedPoints: 0 });
        expect(gradeNumericResponse('1', zero, 10, true)).toEqual({ status: 'incorrect', awardedPoints: -10 });
    });

    it('handles negative expected values, odd wagers, bonuses, and invalid input', () => {
        expect(gradeNumericResponse('-105', { ...config, correctAnswer: -100 }, 10, true).awardedPoints).toBe(10);
        expect(gradeNumericResponse('110', config, 5, true).awardedPoints).toBe(3);
        expect(gradeNumericResponse('100', {
            ...config, ranges: [{ maxPercentOff: 0, pointsPercent: 125 }],
        }, 20, false).awardedPoints).toBe(25);
        expect(() => gradeNumericResponse('no number', config, 20, true)).toThrow('valid number');
    });
});
