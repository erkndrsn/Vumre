import * as migration_20261020_102652_initial from './20261020_102652_initial';
import * as migration_20261020_115423_oda_yerlesim_yetkisi from './20261020_115423_oda_yerlesim_yetkisi';
import * as migration_20261109_090323_tahsilat_dekontlari from './20261109_090323_tahsilat_dekontlari';

export const migrations = [
  {
    up: migration_20261020_102652_initial.up,
    down: migration_20261020_102652_initial.down,
    name: '20261020_102652_initial',
  },
  {
    up: migration_20261020_115423_oda_yerlesim_yetkisi.up,
    down: migration_20261020_115423_oda_yerlesim_yetkisi.down,
    name: '20261020_115423_oda_yerlesim_yetkisi',
  },
  {
    up: migration_20261109_090323_tahsilat_dekontlari.up,
    down: migration_20261109_090323_tahsilat_dekontlari.down,
    name: '20261109_090323_tahsilat_dekontlari'
  },
];
