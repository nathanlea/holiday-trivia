import type { NumericScoringConfig } from '@shared/types';
import { gradeNumericResponse, numericPercentOff, parseNumericResponse } from '@shared/numericScoring';

interface NumericGradeComparisonProps {
    response: string;
    config: NumericScoringConfig;
    assignedPoints: number;
    isFinal: boolean;
    awardedPoints: number;
    status: 'pending' | 'correct' | 'incorrect';
}

const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 6 });
const points = (value: number) => `${value > 0 ? '+' : ''}${format(value)} pts`;

function NumericGradeComparison(props: NumericGradeComparisonProps): JSX.Element {
    const { response, config, assignedPoints, isFinal, awardedPoints, status } = props;
    const value = parseNumericResponse(response);
    if (response.trim() && value === null) {
        return <p className="error">This numeric response is invalid. Review and grade it manually.</p>;
    }
    const suggested = gradeNumericResponse(response, config, assignedPoints, isFinal);
    const percentOff = value === null ? null : numericPercentOff(value, config.correctAnswer);
    const overridden = status !== 'pending' &&
        (awardedPoints !== suggested.awardedPoints || status !== suggested.status);

    return (
        <div className="numeric-grade-comparison">
            <strong>Expected answer: {format(config.correctAnswer)}</strong>
            <p>
                {value === null ? 'No answer - counts as incorrect.' : value === config.correctAnswer ? 'Exact answer.' : (
                    <>Difference: {format(Math.abs(value - config.correctAnswer))} {value > config.correctAnswer ? 'above' : 'below'} expected
                        {' · '}{percentOff !== null && Number.isFinite(percentOff) ? `${format(percentOff)}% off` : 'Percentage difference undefined (expected zero)'}</>
                )}
            </p>
            <p>Automatic score: {points(suggested.awardedPoints)} · Saved score: {status === 'pending' ? 'Not graded' : points(awardedPoints)}</p>
            {overridden && <p className="numeric-grade-override">Host override applied.</p>}
            <small>Host controls below can override the automatic score.</small>
        </div>
    );
}

export default NumericGradeComparison;
