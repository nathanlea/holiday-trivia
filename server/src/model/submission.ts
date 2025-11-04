import {
    CreationOptional,
    DataTypes,
    InferAttributes,
    InferCreationAttributes,
    Model,
    NonAttribute,
    Sequelize,
} from 'sequelize';
import type { Round } from './round';
import type { SubmissionResult } from './submissionResult';
import type { Team } from './team';

export class Submission extends Model<InferAttributes<Submission>, InferCreationAttributes<Submission>> {
    declare id: CreationOptional<string>;
    declare teamId: string;
    declare roundId: string;
    declare submittedAt: string;
    declare answersJson: string;
    declare status: string;

    declare team?: NonAttribute<Team>;
    declare round?: NonAttribute<Round>;
    declare results?: NonAttribute<SubmissionResult[]>;
}

export function initSubmissionModel(sequelize: Sequelize): typeof Submission {
    Submission.init(
        {
            id: {
                type: DataTypes.STRING,
                primaryKey: true,
            },
            teamId: {
                type: DataTypes.STRING,
                allowNull: false,
                field: 'team_id',
            },
            roundId: {
                type: DataTypes.STRING,
                allowNull: false,
                field: 'round_id',
            },
            submittedAt: {
                type: DataTypes.STRING,
                allowNull: false,
                field: 'submitted_at',
            },
            answersJson: {
                type: DataTypes.TEXT,
                allowNull: false,
                field: 'answers_json',
            },
            status: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: 'submitted',
            },
        },
        {
            sequelize,
            tableName: 'submissions',
            underscored: true,
            timestamps: false,
            indexes: [
                {
                    fields: ['team_id', 'round_id'],
                },
            ],
        },
    );

    return Submission;
}
