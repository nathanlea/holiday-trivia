import type { NumericScoringConfig } from './types';

export function parseNumericResponse(response: string): number | null {
    const text = response.trim();
    if (text.includes(',') && !/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?$/.test(text)) {
        return null;
    }
    const normalized = text.replace(/,/g, '');
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
        return null;
    }
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
}

export function numericPercentOff(value: number, correctAnswer: number): number {
    return correctAnswer === 0
        ? (value === 0 ? 0 : Infinity)
        : Math.abs((value - correctAnswer) / correctAnswer) * 100;
}

function withinRange(percentOff: number, limit: number): boolean {
    // Decimal answers exactly on a boundary can have tiny floating-point errors.
    return Number.isFinite(percentOff) && (percentOff <= limit ||
        Math.abs(percentOff - limit) <= Number.EPSILON * Math.max(1, percentOff, limit) * 16);
}

export function gradeNumericResponse(
    response: string,
    config: NumericScoringConfig,
    assignedPoints: number,
    isFinal: boolean,
): { status: 'correct' | 'incorrect'; awardedPoints: number } {
    if (!response.trim()) {
        return { status: 'incorrect', awardedPoints: isFinal && assignedPoints !== 0 ? -assignedPoints : 0 };
    }
    const value = parseNumericResponse(response);
    if (value === null) {
        throw new Error('Numeric answer must be a valid number');
    }
    const percentOff = numericPercentOff(value, config.correctAnswer);
    const range = [...config.ranges]
        .sort((a, b) => a.maxPercentOff - b.maxPercentOff)
        .find((entry) => withinRange(percentOff, entry.maxPercentOff));
    if (range && range.pointsPercent > 0) {
        return { status: 'correct', awardedPoints: Math.round(assignedPoints * range.pointsPercent / 100) };
    }
    const loss = [...(config.wagerLossThresholds ?? [])]
        .sort((a, b) => a.maxPercentOff - b.maxPercentOff)
        .find((entry) => withinRange(percentOff, entry.maxPercentOff));
    const deduction = isFinal ? Math.round(assignedPoints * (loss?.wagerLossPercent ?? 100) / 100) : 0;
    return { status: 'incorrect', awardedPoints: deduction === 0 ? 0 : -deduction };
}
