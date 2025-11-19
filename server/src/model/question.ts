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

export class Question extends Model<InferAttributes<Question>, InferCreationAttributes<Question>> {
    declare id: CreationOptional<string>;
    declare roundId: string;
    declare questionIndex: number;
    declare type: string;
    declare text: string;
    declare choicesJson: string | null;
    declare correctJson: string | null;
    declare explanation: string | null;
    declare numericConfigJson: string | null;

    declare round?: NonAttribute<Round>;
    declare results?: NonAttribute<SubmissionResult[]>;
}

export function initQuestionModel(sequelize: Sequelize): typeof Question {
    Question.init(
        {
            id: {
                type: DataTypes.STRING,
                primaryKey: true,
            },
            roundId: {
                type: DataTypes.STRING,
                allowNull: false,
                field: 'round_id',
            },
            questionIndex: {
                type: DataTypes.INTEGER,
                allowNull: false,
                field: 'question_index',
            },
            type: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            text: {
                type: DataTypes.TEXT,
                allowNull: false,
            },
            choicesJson: {
                type: DataTypes.TEXT,
                allowNull: true,
                field: 'choices_json',
            },
            correctJson: {
                type: DataTypes.TEXT,
                allowNull: true,
                field: 'correct_json',
            },
            explanation: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            numericConfigJson: {
                type: DataTypes.TEXT,
                allowNull: true,
                field: 'numeric_config_json',
            },
        },
        {
            sequelize,
            tableName: 'questions',
            underscored: true,
            timestamps: false,
            indexes: [
                {
                    fields: ['round_id', 'question_index'],
                },
            ],
        },
    );

    return Question;
}
