import {
  pgTable,
  text,
  timestamp,
  integer,
  uuid,
  pgEnum,
  primaryKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const mediaTypeEnum = pgEnum('media_type', ['image', 'video']);


export const users = pgTable('users', {
  id: text('id').primaryKey(), // Clerk user id
  username: text('username').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('users_username_idx').on(t.username),
]);

export const memes = pgTable('memes', {
  id: uuid('id').primaryKey().defaultRandom(),
  uploaderId: text('uploader_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  mediaType: mediaTypeEnum('media_type').notNull(),

  // Cloudinary-owned data — publicId lets us delete/transform the asset later.
  cloudinaryPublicId: text('cloudinary_public_id').notNull(),
  mediaUrl: text('media_url').notNull(),
  thumbnailUrl: text('thumbnail_url'), // poster frame for videos
  durationSec: integer('duration_sec'), // videos only
  width: integer('width'),
  height: integer('height'),

  downloadsCount: integer('downloads_count').notNull().default(0),
  likesCount: integer('likes_count').notNull().default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('memes_uploader_idx').on(t.uploaderId),
  index('memes_created_at_idx').on(t.createdAt),
  index('memes_media_type_idx').on(t.mediaType),
]);

export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(), // stored lowercase, no leading #
}, (t) => [
  uniqueIndex('tags_name_idx').on(t.name),
]);

export const memeTags = pgTable('meme_tags', {
  memeId: uuid('meme_id').notNull().references(() => memes.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.memeId, t.tagId] }),
]);

export const savedMemes = pgTable('saved_memes', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  memeId: uuid('meme_id').notNull().references(() => memes.id, { onDelete: 'cascade' }),
  savedAt: timestamp('saved_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.memeId] }),
]);

// --- Relations (used for Drizzle's relational query API, e.g. db.query.memes.findMany({ with: { uploader: true, tags: true } })) ---

export const usersRelations = relations(users, ({ many }) => ({
  memes: many(memes),
  savedMemes: many(savedMemes),
}));

export const memesRelations = relations(memes, ({ one, many }) => ({
  uploader: one(users, { fields: [memes.uploaderId], references: [users.id] }),
  memeTags: many(memeTags),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  memeTags: many(memeTags),
}));

export const memeTagsRelations = relations(memeTags, ({ one }) => ({
  meme: one(memes, { fields: [memeTags.memeId], references: [memes.id] }),
  tag: one(tags, { fields: [memeTags.tagId], references: [tags.id] }),
}));

export const savedMemesRelations = relations(savedMemes, ({ one }) => ({
  user: one(users, { fields: [savedMemes.userId], references: [users.id] }),
  meme: one(memes, { fields: [savedMemes.memeId], references: [memes.id] }),
}));