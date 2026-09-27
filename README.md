# MemeDrop API

MemeDrop API is the backend for a meme-sharing application. It provides a REST API for discovering memes, uploading image and video media, viewing creator profiles, and managing likes and saved memes.

The service is built with Express and TypeScript. Clerk handles authentication, Neon provides PostgreSQL, Drizzle ORM manages database access and migrations, and Cloudinary stores the uploaded media. Files are uploaded directly from the client to Cloudinary using a server-generated signature; the API stores the resulting media metadata rather than receiving the file bytes itself.

## Features

- Public meme feed with search, media-type filtering, sorting, and cursor pagination
- Image and video uploads through signed Cloudinary uploads
- Meme metadata and tag persistence in PostgreSQL
- Clerk-backed authentication for user actions
- Clerk webhook synchronization for local user profiles
- Likes and private saved-meme collections
- Public creator profiles and creator meme listings
- View and download counters
- Request rate limiting, CORS configuration, structured logging, and centralized errors
- Best-effort cleanup of orphaned Cloudinary assets

## Tech stack

- Node.js and TypeScript
- Express 5
- PostgreSQL hosted by Neon
- Drizzle ORM and Drizzle Kit
- Clerk Express middleware
- Cloudinary
- Zod request validation
- Pino and pino-http logging

## Requirements

- Node.js with npm
- A PostgreSQL-compatible database, such as Neon
- A Clerk application
- A Cloudinary account

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local environment file:

   ```bash
   cp .env.example .env
   ```

3. Fill in the required values in `.env`.

4. Apply the existing Drizzle migrations:

   ```bash
   npm run db:migrate
   ```

5. Start the development server:

   ```bash
   npm run dev
   ```

The API listens on `http://localhost:4000` by default. Check that it is running with:

```bash
curl http://localhost:4000/health
```

Expected response:

```json
{ "ok": true }
```

## Environment variables

Copy `.env.example` to `.env` and provide the following values:

| Variable                       | Required                         | Description                                                                   |
| ------------------------------ | -------------------------------- | ----------------------------------------------------------------------------- |
| `DATABASE_URL`                 | Yes                              | Neon/PostgreSQL connection string used by the API and Drizzle Kit             |
| `CLERK_PUBLISHABLE_KEY`        | Yes for Clerk client integration | Clerk publishable key                                                         |
| `CLERK_SECRET_KEY`             | Yes                              | Clerk secret key used by the server middleware/client                         |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Yes for webhooks                 | Svix signing secret for the Clerk webhook endpoint                            |
| `CLOUDINARY_CLOUD_NAME`        | Yes                              | Cloudinary cloud name                                                         |
| `CLOUDINARY_API_KEY`           | Yes                              | Cloudinary API key                                                            |
| `CLOUDINARY_API_SECRET`        | Yes                              | Cloudinary API secret used to sign uploads and delete assets                  |
| `PORT`                         | No                               | HTTP port; defaults to `4000`                                                 |
| `CORS_ORIGINS`                 | No                               | Comma-separated list of allowed origins; all origins are allowed when omitted |
| `CLEANUP_SECRET`               | No                               | Secret for the maintenance endpoint that removes dangling media               |
| `LOG_LEVEL`                    | No                               | Pino log level; defaults to `info`                                            |
| `NODE_ENV`                     | No                               | Controls development logging formatting                                       |

`DATABASE_URL_UNPOOLED` may also be kept in the environment for provider tooling, but the API currently uses `DATABASE_URL`.

Do not commit `.env` or expose `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, `CLOUDINARY_API_SECRET`, or `CLEANUP_SECRET` to a client.

## Authentication

Clerk middleware runs for every request and makes authentication state available to routes. Routes marked as protected require a valid Clerk session token, normally sent as:

```http
Authorization: Bearer <clerk-session-token>
```

Public routes can still use a valid token. For example, `GET /api/memes/:id` includes `isLiked` and `isSaved` for an authenticated viewer and returns `false` for both when the viewer is anonymous.

## API reference

The server returns JSON for successful requests and errors. Application errors use the shape:

```json
{ "error": "Human-readable message" }
```

### Health

| Method | Path      | Auth   | Description              |
| ------ | --------- | ------ | ------------------------ |
| `GET`  | `/health` | Public | Returns `{ "ok": true }` |

### Memes

| Method   | Path                      | Auth     | Description                                            |
| -------- | ------------------------- | -------- | ------------------------------------------------------ |
| `GET`    | `/api/memes`              | Public   | Lists memes with filters and cursor pagination         |
| `GET`    | `/api/memes/:id`          | Public   | Returns one meme, its tags, uploader, and viewer state |
| `POST`   | `/api/memes`              | Required | Persists metadata after a Cloudinary upload            |
| `POST`   | `/api/memes/:id/view`     | Public   | Increments the view counter                            |
| `POST`   | `/api/memes/:id/download` | Public   | Increments the download counter                        |
| `POST`   | `/api/memes/:id/like`     | Required | Likes a meme; idempotent                               |
| `DELETE` | `/api/memes/:id/like`     | Required | Removes a like; idempotent                             |
| `POST`   | `/api/memes/:id/save`     | Required | Saves a meme privately; idempotent                     |
| `DELETE` | `/api/memes/:id/save`     | Required | Removes a saved meme; idempotent                       |
| `DELETE` | `/api/memes/:id`          | Required | Deletes a meme owned by the current user               |

`GET /api/memes` accepts these query parameters:

| Parameter   | Values                                                | Default  |
| ----------- | ----------------------------------------------------- | -------- |
| `q`         | Text search against titles and tags                   | None     |
| `mediaType` | `image` or `video`                                    | All      |
| `sort`      | `newest`, `oldest`, `most_downloaded`, `most_popular` | `newest` |
| `cursor`    | Cursor returned by the previous response              | None     |
| `limit`     | Integer from 1 to 50                                  | `20`     |

Example:

```bash
curl 'http://localhost:4000/api/memes?mediaType=video&sort=most_popular&limit=20'
```

List responses have this shape:

```json
{
  "memes": [],
  "nextCursor": null
}
```

Create a meme with `POST /api/memes` after uploading the file through the upload flow:

```json
{
  "title": "A useful meme",
  "description": "Optional description",
  "tags": ["funny", "cats"],
  "mediaType": "image",
  "cloudinaryPublicId": "memedrop/images/user-id-123",
  "mediaUrl": "https://res.cloudinary.com/example/image/upload/example.jpg",
  "thumbnailUrl": "https://res.cloudinary.com/example/image/upload/example.jpg",
  "width": 1200,
  "height": 800
}
```

Validation limits include a title between 3 and 80 characters, a description up to 280 characters, up to 8 tags, and video duration up to 60 seconds.

### Uploads

| Method | Path                    | Auth     | Description                                           |
| ------ | ----------------------- | -------- | ----------------------------------------------------- |
| `POST` | `/api/upload/signature` | Required | Returns signed Cloudinary upload parameters           |
| `POST` | `/api/upload/cleanup`   | Required | Deletes an abandoned upload owned by the current user |

Request body for both endpoints uses a media type:

```json
{ "mediaType": "image" }
```

The signature response includes `signature`, `timestamp`, `apiKey`, `cloudName`, `folder`, `publicId`, `resourceType`, and `uploadUrl`. The client should upload the file directly to the returned Cloudinary URL, then call `POST /api/memes` with the returned asset metadata.

Cleanup uses:

```json
{
  "publicId": "user-id-123-1700000000-ab12cd",
  "mediaType": "image"
}
```

### Saved memes

| Method | Path         | Auth     | Description                          |
| ------ | ------------ | -------- | ------------------------------------ |
| `GET`  | `/api/saved` | Required | Lists the current user's saved memes |

### Users

| Method | Path                         | Auth     | Description                                            |
| ------ | ---------------------------- | -------- | ------------------------------------------------------ |
| `POST` | `/api/users/sync`            | Required | Upserts the current Clerk user into the local database |
| `GET`  | `/api/users/:username`       | Public   | Returns public profile information and meme count      |
| `GET`  | `/api/users/:username/memes` | Public   | Lists memes uploaded by a user                         |

### Webhooks

| Method | Path                  | Auth                 | Description                                                     |
| ------ | --------------------- | -------------------- | --------------------------------------------------------------- |
| `POST` | `/api/webhooks/clerk` | Clerk/Svix signature | Syncs `user.created`, `user.updated`, and `user.deleted` events |

Configure the exact URL in the Clerk Dashboard as a webhook endpoint and subscribe it to the three user events above. The route must receive the raw JSON request body so Svix signature verification can succeed; this is already configured before the global JSON parser in `src/server.ts`.

### Maintenance

| Method | Path                 | Auth                     | Description                       |
| ------ | -------------------- | ------------------------ | --------------------------------- |
| `POST` | `/api/memes/cleanup` | `Bearer $CLEANUP_SECRET` | Removes dangling Cloudinary media |

This endpoint is intended for a trusted scheduler or administrator, not for a public client.

## Database

The schema is defined in `src/db/schema.ts`. The main tables are:

- `users`: local projection of Clerk user profiles
- `memes`: meme metadata, Cloudinary identifiers, dimensions, and counters
- `tags` and `meme_tags`: normalized meme tags
- `likes`: per-user likes with a composite primary key
- `saved_memes`: private per-user saved memes with a composite primary key

Useful Drizzle commands:

```bash
# Generate SQL after changing src/db/schema.ts
npm run db:generate

# Apply committed migrations
npm run db:migrate

# Push the schema directly during local prototyping
npm run db:push

# Open Drizzle Studio
npm run db:studio
```

Use migrations for shared and production environments. `db:push` is convenient for local experimentation but does not create the same migration history workflow.

## Development commands

```bash
npm run dev        # Start the server with tsx watch
npm run typecheck  # Run TypeScript without emitting files
npm run build      # Compile src/ to dist/
npm start          # Run the compiled server
```

There is currently no automated test script configured in `package.json`. Run `npm run typecheck` and `npm run build` before submitting changes.

## Project structure

```text
src/
  controllers/     Request handlers and business operations
  db/              Drizzle client and PostgreSQL schema
  lib/             External service clients, including Cloudinary
  logger/          Pino application and HTTP logging
  middleware/      Auth, validation, and error handling
  routes/          Express route definitions
  services/        Supporting external-service workflows
  validators/      Zod request schemas
  server.ts        Application setup and HTTP entry point
drizzle/            Generated SQL migrations and snapshots
```

## Upload lifecycle

1. The authenticated client requests a Cloudinary signature from `/api/upload/signature`.
2. The client uploads the file directly to Cloudinary using the returned parameters.
3. The client persists the Cloudinary metadata through `POST /api/memes`.
4. If metadata persistence fails after the upload succeeds, the client can call `/api/upload/cleanup` to remove the orphaned asset.

This keeps file bytes and large upload bodies away from the API server while retaining server-side control over the signed folder and public ID.

## Production notes

- Set a restrictive `CORS_ORIGINS` value instead of relying on the development default.
- Configure Clerk's webhook URL and keep the signing secret private.
- Run `npm run build` and start `dist/server.js` with `npm start`.
- Use a scheduler or protected operator job for `/api/memes/cleanup`.
- Monitor rate-limit responses and structured Pino logs in the deployment environment.
