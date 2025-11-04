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
import type { Team } from './team';

export class Wager extends Model<InferAttributes<Wager>, InferCreationAttributes<Wager>> {
    declare id: CreationOptional<string>;
    declare teamId: string;
    declare roundId: string;
    declare amount: number;
    declare lockedAt: string;

    declare team?: NonAttribute<Team>;
    declare round?: NonAttribute<Round>;
}

export function initWagerModel(sequelize: Sequelize): typeof Wager {
    Wager.init(
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
            amount: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            lockedAt: {
                type: DataTypes.STRING,
                allowNull: false,
                field: 'locked_at',
            },
        },
        {
            sequelize,
            tableName: 'wagers',
            underscored: true,
            timestamps: false,
            indexes: [
                {
                    unique: true,
                    fields: ['team_id', 'round_id'],
                },
            ],
        },
    );

    return Wager;
}
