import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`users_sessions\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`created_at\` text,
  	\`expires_at\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`users_sessions_order_idx\` ON \`users_sessions\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`users_sessions_parent_id_idx\` ON \`users_sessions\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`users\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text,
  	\`role\` text DEFAULT 'admin',
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`email\` text,
  	\`username\` text NOT NULL,
  	\`reset_password_token\` text,
  	\`reset_password_expiration\` text,
  	\`salt\` text,
  	\`hash\` text,
  	\`reset_password_requested_at\` text,
  	\`login_attempts\` numeric DEFAULT 0,
  	\`lock_until\` text
  );
  `)
  await db.run(sql`CREATE INDEX \`users_updated_at_idx\` ON \`users\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`users_created_at_idx\` ON \`users\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`users_username_idx\` ON \`users\` (\`username\`);`)
  await db.run(sql`CREATE TABLE \`users_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`regions_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`regions_id\`) REFERENCES \`regions\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`users_rels_order_idx\` ON \`users_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`users_rels_parent_idx\` ON \`users_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`users_rels_path_idx\` ON \`users_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`users_rels_regions_id_idx\` ON \`users_rels\` (\`regions_id\`);`)
  await db.run(sql`CREATE TABLE \`media\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`alt\` text NOT NULL,
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
  	\`focal_y\` numeric
  );
  `)
  await db.run(sql`CREATE INDEX \`media_updated_at_idx\` ON \`media\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`media_created_at_idx\` ON \`media\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`media_filename_idx\` ON \`media\` (\`filename\`);`)
  await db.run(sql`CREATE TABLE \`flight_points\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`city\` text NOT NULL,
  	\`airport_code\` text,
  	\`is_main\` integer DEFAULT false,
  	\`description\` text,
  	\`active\` integer DEFAULT true,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`flight_points_name_idx\` ON \`flight_points\` (\`name\`);`)
  await db.run(sql`CREATE INDEX \`flight_points_updated_at_idx\` ON \`flight_points\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`flight_points_created_at_idx\` ON \`flight_points\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`regions\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`default_flight_point_id\` integer,
  	\`description\` text,
  	\`active\` integer DEFAULT true,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`default_flight_point_id\`) REFERENCES \`flight_points\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`regions_name_idx\` ON \`regions\` (\`name\`);`)
  await db.run(sql`CREATE INDEX \`regions_default_flight_point_idx\` ON \`regions\` (\`default_flight_point_id\`);`)
  await db.run(sql`CREATE INDEX \`regions_updated_at_idx\` ON \`regions\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`regions_created_at_idx\` ON \`regions\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`room_types_child_prices\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`min_age\` numeric NOT NULL,
  	\`max_age\` numeric NOT NULL,
  	\`price\` numeric NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`room_types\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`room_types_child_prices_order_idx\` ON \`room_types_child_prices\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`room_types_child_prices_parent_id_idx\` ON \`room_types_child_prices\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`room_types_other_prices\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`currency\` text NOT NULL,
  	\`price_per_person\` numeric NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`room_types\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`room_types_other_prices_order_idx\` ON \`room_types_other_prices\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`room_types_other_prices_parent_id_idx\` ON \`room_types_other_prices\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`room_types\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`capacity\` numeric NOT NULL,
  	\`price_per_person\` numeric NOT NULL,
  	\`currency\` text DEFAULT 'USD' NOT NULL,
  	\`description\` text,
  	\`active\` integer DEFAULT true,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`room_types_name_idx\` ON \`room_types\` (\`name\`);`)
  await db.run(sql`CREATE INDEX \`room_types_updated_at_idx\` ON \`room_types\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`room_types_created_at_idx\` ON \`room_types\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`rooms\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`room_number\` text NOT NULL,
  	\`room_type_id\` integer NOT NULL,
  	\`capacity\` numeric,
  	\`active\` integer DEFAULT true,
  	\`description\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`room_type_id\`) REFERENCES \`room_types\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`rooms_room_number_idx\` ON \`rooms\` (\`room_number\`);`)
  await db.run(sql`CREATE INDEX \`rooms_room_type_idx\` ON \`rooms\` (\`room_type_id\`);`)
  await db.run(sql`CREATE INDEX \`rooms_updated_at_idx\` ON \`rooms\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`rooms_created_at_idx\` ON \`rooms\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`pilgrims_room_other_prices\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` integer NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`currency\` text NOT NULL,
  	\`price\` numeric NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`pilgrims\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`pilgrims_room_other_prices_order_idx\` ON \`pilgrims_room_other_prices\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`pilgrims_room_other_prices_parent_id_idx\` ON \`pilgrims_room_other_prices\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`pilgrims\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`first_name\` text NOT NULL,
  	\`last_name\` text NOT NULL,
  	\`full_name\` text,
  	\`tc_no\` text,
  	\`passport_no\` text,
  	\`phone\` text,
  	\`birth_date\` text,
  	\`gender\` text NOT NULL,
  	\`region_id\` integer,
  	\`flight_point_id\` integer,
  	\`address\` text,
  	\`description\` text,
  	\`room_id\` integer,
  	\`payment_group_id\` integer,
  	\`room_price\` numeric,
  	\`room_currency\` text,
  	\`archived\` integer DEFAULT false,
  	\`archived_at\` text,
  	\`archive_reason\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`region_id\`) REFERENCES \`regions\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`flight_point_id\`) REFERENCES \`flight_points\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`room_id\`) REFERENCES \`rooms\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`payment_group_id\`) REFERENCES \`payment_groups\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`pilgrims_full_name_idx\` ON \`pilgrims\` (\`full_name\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`pilgrims_tc_no_idx\` ON \`pilgrims\` (\`tc_no\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`pilgrims_passport_no_idx\` ON \`pilgrims\` (\`passport_no\`);`)
  await db.run(sql`CREATE INDEX \`pilgrims_region_idx\` ON \`pilgrims\` (\`region_id\`);`)
  await db.run(sql`CREATE INDEX \`pilgrims_flight_point_idx\` ON \`pilgrims\` (\`flight_point_id\`);`)
  await db.run(sql`CREATE INDEX \`pilgrims_room_idx\` ON \`pilgrims\` (\`room_id\`);`)
  await db.run(sql`CREATE INDEX \`pilgrims_payment_group_idx\` ON \`pilgrims\` (\`payment_group_id\`);`)
  await db.run(sql`CREATE INDEX \`pilgrims_archived_idx\` ON \`pilgrims\` (\`archived\`);`)
  await db.run(sql`CREATE INDEX \`pilgrims_updated_at_idx\` ON \`pilgrims\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`pilgrims_created_at_idx\` ON \`pilgrims\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`pilgrim_documents\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`pilgrim_id\` integer NOT NULL,
  	\`kind\` text DEFAULT 'other' NOT NULL,
  	\`note\` text,
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
  	FOREIGN KEY (\`pilgrim_id\`) REFERENCES \`pilgrims\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`pilgrim_documents_pilgrim_idx\` ON \`pilgrim_documents\` (\`pilgrim_id\`);`)
  await db.run(sql`CREATE INDEX \`pilgrim_documents_updated_at_idx\` ON \`pilgrim_documents\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`pilgrim_documents_created_at_idx\` ON \`pilgrim_documents\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`pilgrim_documents_filename_idx\` ON \`pilgrim_documents\` (\`filename\`);`)
  await db.run(sql`CREATE INDEX \`pilgrim_documents_sizes_thumbnail_sizes_thumbnail_filena_idx\` ON \`pilgrim_documents\` (\`sizes_thumbnail_filename\`);`)
  await db.run(sql`CREATE TABLE \`payment_groups\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`responsible_id\` integer,
  	\`note\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`responsible_id\`) REFERENCES \`pilgrims\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`payment_groups_name_idx\` ON \`payment_groups\` (\`name\`);`)
  await db.run(sql`CREATE INDEX \`payment_groups_responsible_idx\` ON \`payment_groups\` (\`responsible_id\`);`)
  await db.run(sql`CREATE INDEX \`payment_groups_updated_at_idx\` ON \`payment_groups\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payment_groups_created_at_idx\` ON \`payment_groups\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`cashboxes\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text NOT NULL,
  	\`currency\` text NOT NULL,
  	\`kind\` text DEFAULT 'cash' NOT NULL,
  	\`active\` integer DEFAULT true,
  	\`note\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`cashboxes_name_idx\` ON \`cashboxes\` (\`name\`);`)
  await db.run(sql`CREATE INDEX \`cashboxes_currency_idx\` ON \`cashboxes\` (\`currency\`);`)
  await db.run(sql`CREATE INDEX \`cashboxes_active_idx\` ON \`cashboxes\` (\`active\`);`)
  await db.run(sql`CREATE INDEX \`cashboxes_updated_at_idx\` ON \`cashboxes\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`cashboxes_created_at_idx\` ON \`cashboxes\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payments\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`pilgrim_id\` integer NOT NULL,
  	\`amount\` numeric NOT NULL,
  	\`currency\` text,
  	\`cashbox_id\` integer,
  	\`debt_amount\` numeric,
  	\`debt_currency\` text,
  	\`paid_at\` text NOT NULL,
  	\`method\` text DEFAULT 'cash' NOT NULL,
  	\`receipt_no\` text,
  	\`note\` text,
  	\`received_by_id\` integer,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`pilgrim_id\`) REFERENCES \`pilgrims\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`cashbox_id\`) REFERENCES \`cashboxes\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`received_by_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`payments_pilgrim_idx\` ON \`payments\` (\`pilgrim_id\`);`)
  await db.run(sql`CREATE INDEX \`payments_currency_idx\` ON \`payments\` (\`currency\`);`)
  await db.run(sql`CREATE INDEX \`payments_cashbox_idx\` ON \`payments\` (\`cashbox_id\`);`)
  await db.run(sql`CREATE INDEX \`payments_debt_currency_idx\` ON \`payments\` (\`debt_currency\`);`)
  await db.run(sql`CREATE INDEX \`payments_paid_at_idx\` ON \`payments\` (\`paid_at\`);`)
  await db.run(sql`CREATE INDEX \`payments_received_by_idx\` ON \`payments\` (\`received_by_id\`);`)
  await db.run(sql`CREATE INDEX \`payments_updated_at_idx\` ON \`payments\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payments_created_at_idx\` ON \`payments\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`expenses\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`description\` text NOT NULL,
  	\`category\` text DEFAULT 'other' NOT NULL,
  	\`payee\` text,
  	\`cashbox_id\` integer,
  	\`amount\` numeric NOT NULL,
  	\`currency\` text NOT NULL,
  	\`paid_at\` text NOT NULL,
  	\`method\` text DEFAULT 'cash' NOT NULL,
  	\`receipt_no\` text,
  	\`note\` text,
  	\`paid_by_id\` integer,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`cashbox_id\`) REFERENCES \`cashboxes\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`paid_by_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`expenses_category_idx\` ON \`expenses\` (\`category\`);`)
  await db.run(sql`CREATE INDEX \`expenses_cashbox_idx\` ON \`expenses\` (\`cashbox_id\`);`)
  await db.run(sql`CREATE INDEX \`expenses_currency_idx\` ON \`expenses\` (\`currency\`);`)
  await db.run(sql`CREATE INDEX \`expenses_paid_at_idx\` ON \`expenses\` (\`paid_at\`);`)
  await db.run(sql`CREATE INDEX \`expenses_paid_by_idx\` ON \`expenses\` (\`paid_by_id\`);`)
  await db.run(sql`CREATE INDEX \`expenses_updated_at_idx\` ON \`expenses\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`expenses_created_at_idx\` ON \`expenses\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`cash_transfers\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`from_id\` integer NOT NULL,
  	\`to_id\` integer NOT NULL,
  	\`amount\` numeric NOT NULL,
  	\`to_amount\` numeric,
  	\`transferred_at\` text NOT NULL,
  	\`note\` text,
  	\`created_by_id\` integer,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`from_id\`) REFERENCES \`cashboxes\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`to_id\`) REFERENCES \`cashboxes\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`created_by_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`cash_transfers_from_idx\` ON \`cash_transfers\` (\`from_id\`);`)
  await db.run(sql`CREATE INDEX \`cash_transfers_to_idx\` ON \`cash_transfers\` (\`to_id\`);`)
  await db.run(sql`CREATE INDEX \`cash_transfers_transferred_at_idx\` ON \`cash_transfers\` (\`transferred_at\`);`)
  await db.run(sql`CREATE INDEX \`cash_transfers_created_by_idx\` ON \`cash_transfers\` (\`created_by_id\`);`)
  await db.run(sql`CREATE INDEX \`cash_transfers_updated_at_idx\` ON \`cash_transfers\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`cash_transfers_created_at_idx\` ON \`cash_transfers\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_kv\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`key\` text NOT NULL,
  	\`data\` text NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`payload_kv_key_idx\` ON \`payload_kv\` (\`key\`);`)
  await db.run(sql`CREATE TABLE \`payload_locked_documents\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`global_slug\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_global_slug_idx\` ON \`payload_locked_documents\` (\`global_slug\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_updated_at_idx\` ON \`payload_locked_documents\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_created_at_idx\` ON \`payload_locked_documents\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_locked_documents_rels\` (
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
  await db.run(sql`CREATE TABLE \`payload_preferences\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`key\` text,
  	\`value\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_preferences_key_idx\` ON \`payload_preferences\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_updated_at_idx\` ON \`payload_preferences\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_created_at_idx\` ON \`payload_preferences\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_preferences_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` integer NOT NULL,
  	\`path\` text NOT NULL,
  	\`users_id\` integer,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_preferences\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_order_idx\` ON \`payload_preferences_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_parent_idx\` ON \`payload_preferences_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_path_idx\` ON \`payload_preferences_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_users_id_idx\` ON \`payload_preferences_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE TABLE \`payload_migrations\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`name\` text,
  	\`batch\` numeric,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_migrations_updated_at_idx\` ON \`payload_migrations\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_migrations_created_at_idx\` ON \`payload_migrations\` (\`created_at\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`users_sessions\`;`)
  await db.run(sql`DROP TABLE \`users\`;`)
  await db.run(sql`DROP TABLE \`users_rels\`;`)
  await db.run(sql`DROP TABLE \`media\`;`)
  await db.run(sql`DROP TABLE \`flight_points\`;`)
  await db.run(sql`DROP TABLE \`regions\`;`)
  await db.run(sql`DROP TABLE \`room_types_child_prices\`;`)
  await db.run(sql`DROP TABLE \`room_types_other_prices\`;`)
  await db.run(sql`DROP TABLE \`room_types\`;`)
  await db.run(sql`DROP TABLE \`rooms\`;`)
  await db.run(sql`DROP TABLE \`pilgrims_room_other_prices\`;`)
  await db.run(sql`DROP TABLE \`pilgrims\`;`)
  await db.run(sql`DROP TABLE \`pilgrim_documents\`;`)
  await db.run(sql`DROP TABLE \`payment_groups\`;`)
  await db.run(sql`DROP TABLE \`cashboxes\`;`)
  await db.run(sql`DROP TABLE \`payments\`;`)
  await db.run(sql`DROP TABLE \`expenses\`;`)
  await db.run(sql`DROP TABLE \`cash_transfers\`;`)
  await db.run(sql`DROP TABLE \`payload_kv\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_preferences\`;`)
  await db.run(sql`DROP TABLE \`payload_preferences_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_migrations\`;`)
}
