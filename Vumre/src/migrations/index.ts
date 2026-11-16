import * as migration_20261020_102652_initial from './20261020_102652_initial';
import * as migration_20261020_115423_oda_yerlesim_yetkisi from './20261020_115423_oda_yerlesim_yetkisi';
import * as migration_20261109_090323_tahsilat_dekontlari from './20261109_090323_tahsilat_dekontlari';
import * as migration_20261116_082551_fiyat_sabitleme from './20261116_082551_fiyat_sabitleme';
import * as migration_20261116_122930_bagis from './20261116_122930_bagis';

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
    name: '20261109_090323_tahsilat_dekontlari',
  },
  {
    up: migration_20261116_082551_fiyat_sabitleme.up,
    down: migration_20261116_082551_fiyat_sabitleme.down,
    name: '20261116_082551_fiyat_sabitleme',
  },
  {
    up: migration_20261116_122930_bagis.up,
    down: migration_20261116_122930_bagis.down,
    name: '20261116_122930_bagis'
  },
];
