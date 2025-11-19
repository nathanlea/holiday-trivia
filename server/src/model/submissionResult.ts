import {
    CreationOptional,
    DataTypes,
    InferAttributes,
    InferCreationAttributes,
    Model,
    NonAttribute,
    Sequelize,
} from 'sequelize';
import type { Question } from './question';
import type { Submission } from './submission';

export class SubmissionResult extends Model<InferAttributes<SubmissionResult>, InferCreationAttributes<SubmissionResult>> {
    declare id: CreationOptional<string>;
    declare submissionId: string;
    declare questionId: string;
    declare assignedPoint: number | null;
    declare status: string;
    declare awardedPoints: number;
    declare updatedAt: string;

    declare submission?: NonAttribute<Submission>;
    declare question?: NonAttribute<Question>;
}

export function initSubmissionResultModel(sequelize: Sequelize): typeof SubmissionResult {
    SubmissionResult.init(
        {
            id: {
                type: DataTypes.STRING,
                primaryKey: true,
            },
            submissionId: {
                type: DataTypes.STRING,
                allowNull: false,
                field: 'submission_id',
                unique: false,
            },
            questionId: {
                type: DataTypes.STRING,
                allowNull: false,
                field: 'question_id',
                unique: false,
            },
            assignedPoint: {
                type: DataTypes.INTEGER,
                allowNull: true,
                field: 'assigned_point',
            },
            status: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: 'pending',
            },
            awardedPoints: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
                field: 'awarded_points',
            },
            updatedAt: {
                type: DataTypes.STRING,
                allowNull: false,
                field: 'updated_at',
            },
        },
        {
            sequelize,
            tableName: 'submission_results',
            underscored: true,
            timestamps: false,
            indexes: [
                {
                    unique: true,
                    fields: ['submission_id', 'question_id'],
                },
            ],
        },
    );

    return SubmissionResult;
}
