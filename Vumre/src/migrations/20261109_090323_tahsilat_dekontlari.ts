import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`payment_receipts\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`payment_id\` integer NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`url\` text,
  	\`thumbnail_u_r_l\` text,
  	\`filename\` text,
  	\`mime_type\` text,
  	\`filesize\` numeric,
  	\`width\` numeric,
  	\`height\` numeric,
  	\`focal_x\` numeric,
  	\`focal_y\` numeric,
  	\`sizes_thumbnail_url\` text,
  	\`sizes_thumbnail_width\` numeric,
  	\`sizes_thumbnail_height\` numeric,
  	\`sizes_thumbnail_mime_type\` text,
  	\`sizes_thumbnail_filesize\` numeric,
  	\`sizes_thumbnail_filename\` text,
  	FOREIGN KEY (\`payment_id\`) REFERENCES \`payments\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`payment_receipts_payment_idx\` ON \`payment_receipts\` (\`payment_id\`);`)
  await db.run(sql`CREATE INDEX \`payment_receipts_updated_at_idx\` ON \`payment_receipts\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payment_receipts_created_at_idx\` ON \`payment_receipts\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`payment_receipts_filename_idx\` ON \`payment_receipts\` (\`filename\`);`)
  await db.run(sql`CREATE INDEX \`payment_receipts_sizes_thumbnail_sizes_thumbnail_filenam_idx\` ON \`payment_receipts\` (\`sizes_thumbnail_filename\`);`)
  await db.run(sql`ALTER TABLE \`payload_locked_documents_rels\` ADD \`payment_receipts_id\` integer REFERENCES payment_receipts(id);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_payment_receipts_id_idx\` ON \`payload_locked_documents_rels\` (\`payment_receipts_id\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`payment_receipts\`;`)
  await db.run(sql`PRAGMA foreign_keys=OFF;`)
  await db.run(sql`CREATE TABLE \`__new_payload_locked_documents_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	\`media_id\` integer,
  	\`flight_points_id\` integer,
  	\`regions_id\` integer,
  	\`room_types_id\` integer,
  	\`rooms_id\` integer,
  	\`pilgrims_id\` integer,
  	\`pilgrim_documents_id\` integer,
  	\`payment_groups_id\` integer,
  	\`cashboxes_id\` integer,
  	\`payments_id\` integer,
  	\`expenses_id\` integer,
  	\`cash_transfers_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_locked_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`media_id\`) REFERENCES \`media\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`flight_points_id\`) REFERENCES \`flight_points\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`regions_id\`) REFERENCES \`regions\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`room_types_id\`) REFERENCES \`room_types\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`rooms_id\`) REFERENCES \`rooms\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`pilgrims_id\`) REFERENCES \`pilgrims\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`pilgrim_documents_id\`) REFERENCES \`pilgrim_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`payment_groups_id\`) REFERENCES \`payment_groups\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`cashboxes_id\`) REFERENCES \`cashboxes\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`payments_id\`) REFERENCES \`payments\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`expenses_id\`) REFERENCES \`expenses\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`cash_transfers_id\`) REFERENCES \`cash_transfers\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`INSERT INTO \`__new_payload_locked_documents_rels\`("id", "order", "parent_id", "path", "users_id", "media_id", "flight_points_id", "regions_id", "room_types_id", "rooms_id", "pilgrims_id", "pilgrim_documents_id", "payment_groups_id", "cashboxes_id", "payments_id", "expenses_id", "cash_transfers_id") SELECT "id", "order", "parent_id", "path", "users_id", "media_id", "flight_points_id", "regions_id", "room_types_id", "rooms_id", "pilgrims_id", "pilgrim_documents_id", "payment_groups_id", "cashboxes_id", "payments_id", "expenses_id", "cash_transfers_id" FROM \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`ALTER TABLE \`__new_payload_locked_documents_rels\` RENAME TO \`payload_locked_documents_rels\`;`)
  await db.run(sql`PRAGMA foreign_keys=ON;`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_media_id_idx\` ON \`payload_locked_documents_rels\` (\`media_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_flight_points_id_idx\` ON \`payload_locked_documents_rels\` (\`flight_points_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_regions_id_idx\` ON \`payload_locked_documents_rels\` (\`regions_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_room_types_id_idx\` ON \`payload_locked_documents_rels\` (\`room_types_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_rooms_id_idx\` ON \`payload_locked_documents_rels\` (\`rooms_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_pilgrims_id_idx\` ON \`payload_locked_documents_rels\` (\`pilgrims_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_pilgrim_documents_id_idx\` ON \`payload_locked_documents_rels\` (\`pilgrim_documents_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_payment_groups_id_idx\` ON \`payload_locked_documents_rels\` (\`payment_groups_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_cashboxes_id_idx\` ON \`payload_locked_documents_rels\` (\`cashboxes_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_payments_id_idx\` ON \`payload_locked_documents_rels\` (\`payments_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_expenses_id_idx\` ON \`payload_locked_documents_rels\` (\`expenses_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_cash_transfers_id_idx\` ON \`payload_locked_documents_rels\` (\`cash_transfers_id\`);`)
}
