CREATE TYPE "public"."media_type" AS ENUM('image', 'video');--> statement-breakpoint
CREATE TABLE "meme_tags" (
	"meme_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "meme_tags_meme_id_tag_id_pk" PRIMARY KEY("meme_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "memes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploader_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"media_type" "media_type" NOT NULL,
	"cloudinary_public_id" text NOT NULL,
	"media_url" text NOT NULL,
	"thumbnail_url" text,
	"duration_sec" integer,
	"width" integer,
	"height" integer,
	"downloads_count" integer DEFAULT 0 NOT NULL,
	"likes_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_memes" (
	"user_id" text NOT NULL,
	"meme_id" uuid NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_memes_user_id_meme_id_pk" PRIMARY KEY("user_id","meme_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meme_tags" ADD CONSTRAINT "meme_tags_meme_id_memes_id_fk" FOREIGN KEY ("meme_id") REFERENCES "public"."memes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meme_tags" ADD CONSTRAINT "meme_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memes" ADD CONSTRAINT "memes_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_memes" ADD CONSTRAINT "saved_memes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_memes" ADD CONSTRAINT "saved_memes_meme_id_memes_id_fk" FOREIGN KEY ("meme_id") REFERENCES "public"."memes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memes_uploader_idx" ON "memes" USING btree ("uploader_id");--> statement-breakpoint
CREATE INDEX "memes_created_at_idx" ON "memes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "memes_media_type_idx" ON "memes" USING btree ("media_type");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_idx" ON "tags" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_idx" ON "users" USING btree ("username");