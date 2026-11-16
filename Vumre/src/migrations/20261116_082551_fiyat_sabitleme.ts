import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`ALTER TABLE \`pilgrims\` ADD \`price_locked\` integer DEFAULT false;`)
  await db.run(sql`CREATE INDEX \`pilgrims_price_locked_idx\` ON \`pilgrims\` (\`price_locked\`);`)
  // Şimdiye kadar tahsilatı olan herkesin (ödeme grubundaysa grubun tüm üyelerinin) fiyatı
  // sabitlenir; fiyat artışı yalnız hiç ödeme yapmamış olanlara yansır.
  await db.run(sql`UPDATE \`pilgrims\` SET \`price_locked\` = 1
    WHERE \`id\` IN (SELECT \`pilgrim_id\` FROM \`payments\`)
       OR \`payment_group_id\` IN (
         SELECT p.\`payment_group_id\` FROM \`pilgrims\` p
         JOIN \`payments\` pay ON pay.\`pilgrim_id\` = p.\`id\`
         WHERE p.\`payment_group_id\` IS NOT NULL
       );`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP INDEX \`pilgrims_price_locked_idx\`;`)
  await db.run(sql`ALTER TABLE \`pilgrims\` DROP COLUMN \`price_locked\`;`)
}
