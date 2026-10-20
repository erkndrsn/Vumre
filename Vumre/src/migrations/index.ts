import * as migration_20261020_102652_initial from './20261020_102652_initial';

export const migrations = [
  {
    up: migration_20261020_102652_initial.up,
    down: migration_20261020_102652_initial.down,
    name: '20261020_102652_initial'
  },
];
