import {
    CreationOptional,
    DataTypes,
    InferAttributes,
    InferCreationAttributes,
    Model,
    NonAttribute,
    Sequelize,
} from 'sequelize';
import type { Game } from './game';
import type { Question } from './question';
import type { Submission } from './submission';
import type { Wager } from './wager';

export class Round extends Model<InferAttributes<Round>, InferCreationAttributes<Round>> {
    declare id: CreationOptional<string>;
    declare gameId: string;
    declare roundIndex: number;
    declare label: string;
    declare pointOptions: string;
    declare timeLimitSeconds: number | null;
    declare isFinal: boolean;
    declare status: string;
    declare openedAt: string | null;
    declare closedAt: string | null;
    declare mode: string;
    declare linkedRoundId: string | null;

    declare game?: NonAttribute<Game>;
    declare questions?: NonAttribute<Question[]>;
    declare submissions?: NonAttribute<Submission[]>;
    declare wagers?: NonAttribute<Wager[]>;
}

export function initRoundModel(sequelize: Sequelize): typeof Round {
    Round.init(
        {
            id: {
                type: DataTypes.STRING,
                primaryKey: true,
            },
            gameId: {
                type: DataTypes.STRING,
                allowNull: false,
                field: 'game_id',
            },
            roundIndex: {
                type: DataTypes.INTEGER,
                allowNull: false,
                field: 'round_index',
            },
            label: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            pointOptions: {
                type: DataTypes.TEXT,
                allowNull: false,
                field: 'point_options',
            },
            timeLimitSeconds: {
                type: DataTypes.INTEGER,
                allowNull: true,
                field: 'time_limit_seconds',
            },
            isFinal: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
                field: 'is_final',
            },
            status: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: 'pending',
            },
            openedAt: {
                type: DataTypes.STRING,
                allowNull: true,
                field: 'opened_at',
            },
            closedAt: {
                type: DataTypes.STRING,
                allowNull: true,
                field: 'closed_at',
            },
            mode: {
                type: DataTypes.STRING,
                allowNull: false,
                defaultValue: 'standard',
            },
            linkedRoundId: {
                type: DataTypes.STRING,
                allowNull: true,
                field: 'linked_round_id',
            },
        },
        {
            sequelize,
            tableName: 'rounds',
            underscored: true,
            timestamps: false,
            indexes: [
                {
                    fields: ['game_id', 'round_index'],
                },
            ],
        },
    );

    return Round;
}
