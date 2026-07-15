import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260710191204 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "provider_setting" drop constraint if exists "provider_setting_provider_unique";`);
    this.addSql(`create table if not exists "provider_setting" ("id" text not null, "provider" text not null, "mode" text not null default 'sandbox', "is_enabled" boolean not null default true, "public_config" jsonb null, "encrypted_secrets" text null, "secret_hints" jsonb null, "last_verified_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "provider_setting_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_provider_setting_provider_unique" ON "provider_setting" ("provider") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_provider_setting_deleted_at" ON "provider_setting" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "provider_setting" cascade;`);
  }

}
