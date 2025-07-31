Below is a **complete, production-ready README.md** for your project, written in clear English.
You can **copy & paste** it as `README.md` at the repository root.

---

# Fitness API (Fastify + Node.js + MongoDB)

A modular-monolith REST API for a fitness mobile app (React Native).
It provides authentication, exercises, workouts, workout logs, templates, media uploads (Cloudinary), albums, body measurements, shopping lists with budget and price history, recipe integration (Spoonacular, optional), and analytics (stats + dashboard).

* **Framework:** Fastify (Node 20)
* **DB:** MongoDB (Mongoose)
* **Auth:** JWT (Bearer)
* **Docs:** Swagger (OpenAPI) at `/documentation`
* **Uploads:** Cloudinary
* **Push:** OneSignal (NO-OP if not configured)
* **External recipes:** Spoonacular (optional; gracefully disabled if no API key)

---

## Features

* **Auth & Users** — JWT login/registration and user safety responses.
* **Exercises** — CRUD with public/private flag and filters.
* **Workouts** — Modular blocks referencing exercises (sets, reps, time).
* **Workout Logs** — Create logs from a workout, update sets, notes, finalize sessions.
* **Workout Templates** — Public and private templates + cloning.
* **Media** — Cloudinary uploads, tags, albums, and before/after comparisons.
* **Body Measurements** — Measurements + progress photos and progress endpoints.
* **Shopping Lists** — Budget, categories, price history, spending alerts,
  price estimation based **only on your own purchase history** with **kg↔g** and **l↔ml** conversions;
  create a list from a **meal plan** restricted to items you have previously purchased.
* **Recipes (optional)** — Spoonacular integration (search/details/nutrition) with graceful 501 if not configured.
* **Stats & Dashboard** — Time series, period comparisons, PRs, top exercises/muscle groups, configurable widgets.

---

## Tech Stack

* Node.js 20, Fastify, @fastify/swagger, @fastify/jwt, @fastify/multipart, @fastify/cors, @fastify/sensible
* Mongoose (MongoDB)
* Zod (request validation)
* Cloudinary SDK
* OneSignal (server SDK) — **NO-OP** if not configured
* Axios (HTTP client) for external APIs

---

## Project Structure (modular monolith)

```
src/
  models/
    dashboardConfig.js
    exercise.js
    media.js
    measurement.js
    shoppingList.js
    user.js
    workout.js
    workoutLog.js
    workoutTemplate.js
  plugins/
    auth.js
    cloudinary.js
    db.js
    onesignal.js     # NO-OP if no keys
    schemas.js
    spoonacular.js   # graceful 501 if no key
  routes/
    albums.js
    dashboard.js
    exercises.js
    measurements.js
    media.js
    recipes.js       # optional endpoints
    shoppingLists.js
    stats.js
    users.js
    workouts.js
    workoutLogs.js
    workoutTemplates.js
  server.js
```

---

## Requirements

* Node.js **v20+**
* npm or yarn
* MongoDB 6+ (local or Docker)
* Cloudinary account (for media; optional in dev if you don’t call upload routes)
* (Optional) OneSignal app & API key
* (Optional) Spoonacular API key

---

## Getting Started (Local Development)

1. **Install dependencies**

```bash
npm install
# or
yarn
```

2. **Configure environment**

* Copy `.env.example` to `.env` and fill values as needed.
* Minimum for local dev: `MONGO_URI`, `JWT_SECRET`.
* Cloudinary keys required only if you call media upload endpoints.

3. **Run MongoDB**

* Local MongoDB or Docker:

```bash
docker compose up -d mongo
```

4. **Start the API (dev)**

```bash
npm run dev
# or
yarn dev
```

5. **Open Swagger**

* Navigate to: `http://localhost:3000/documentation`

---

## Environment Variables

**Core**

* `NODE_ENV` — `development` | `production`
* `PORT` — default `3000`
* `HOST` — default `0.0.0.0`
* `LOG_LEVEL` — e.g. `info`

**CORS**

* `CORS_ORIGINS` — comma-separated origins for production. Empty in dev allows all.

**JWT**

* `JWT_SECRET` — **long, random string**
* `JWT_EXPIRES_IN` — e.g. `7d`

**Mongo**

* `MONGO_URI` — e.g. `mongodb://localhost:27017/fitness`

**Cloudinary**

* `CLOUDINARY_CLOUD_NAME`
* `CLOUDINARY_API_KEY`
* `CLOUDINARY_API_SECRET`
* `CLOUDINARY_FOLDER` — e.g. `fitness`

**OneSignal** (optional; NO-OP if empty)

* `ONESIGNAL_APP_ID`
* `ONESIGNAL_API_KEY`

**Spoonacular** (optional; 501 if empty)

* `SPOONACULAR_API_KEY`

---

## Running with Docker

**Compose (Mongo + API)**

```bash
docker compose up -d
# ensures Mongo is up; API service uses your .env
```

**Dockerfile build**

```bash
docker build -t fitness-api:1.0.0 .
docker run --env-file .env -p 3000:3000 fitness-api:1.0.0
```

---

## Authentication

* Bearer JWT on all protected routes.
* Use Swagger “Authorize” button with:

```
Authorization: Bearer <your-jwt>
```

Typical flow:

1. `POST /v1/auth/register`
2. `POST /v1/auth/login` → get JWT
3. Click **Authorize** in Swagger and paste `Bearer <token>`.

---

## API Overview (by domain)

> Full schemas and examples are available in **Swagger**.
> Only high-level overview below.

### Auth & Users

* `POST /v1/auth/register`
* `POST /v1/auth/login`
* `GET /v1/users/me` (if implemented in your `users.js`)

### Exercises

* `POST /v1/exercises`
* `GET /v1/exercises` (pagination, filters)
* `GET /v1/exercises/:id`
* `PUT /v1/exercises/:id`
* `DELETE /v1/exercises/:id`

### Workouts

* `POST /v1/workouts`
* `GET /v1/workouts`
* `GET /v1/workouts/:id`
* `PUT /v1/workouts/:id`
* `DELETE /v1/workouts/:id`

### Workout Logs

* `POST /v1/workout-logs/from-workout/:workoutId`
* `GET /v1/workout-logs`
* `GET /v1/workout-logs/:id`
* `PUT /v1/workout-logs/:id`
* **PATCH (quality of life)**

  * finalize a session
  * update a single set
  * update session notes/duration
    *(see Swagger for the exact endpoints defined in your `workoutLogs.js`)*

### Workout Templates

* `POST /v1/workout-templates`
* `GET /v1/workout-templates`
* `GET /v1/workout-templates/:id`
* `PUT /v1/workout-templates/:id`
* `DELETE /v1/workout-templates/:id`
* Clone helpers if included.

### Media (Cloudinary)

* `POST /v1/media/upload` (multipart: `file` + optional `tags[]`, `albumId`)
* `GET /v1/media`
* `GET /v1/media/:id`
* `DELETE /v1/media/:id`
* `PATCH /v1/media/:id/tags`
* `PATCH /v1/media/:id/move-to-album`
* Comparisons:

  * `POST /v1/media/compare`
  * `GET /v1/media/compare`
  * `GET /v1/media/compare/:id`
  * `DELETE /v1/media/compare/:id`

### Albums

* `POST /v1/albums`
* `GET /v1/albums`
* `GET /v1/albums/:id`
* `PUT /v1/albums/:id`
* `DELETE /v1/albums/:id`

### Measurements

* `POST /v1/measurements`
* `GET /v1/measurements`
* `GET /v1/measurements/:id`
* `PUT /v1/measurements/:id`
* `DELETE /v1/measurements/:id`
* `PATCH /v1/measurements/:id/photos`
* `GET /v1/measurements/progress`

### Shopping Lists (budget, history, estimation, meal plan)

* Lists CRUD:

  * `POST /v1/shopping-lists`
  * `GET /v1/shopping-lists`
  * `GET /v1/shopping-lists/:id`
  * `PUT /v1/shopping-lists/:id`
  * `DELETE /v1/shopping-lists/:id`
* Items:

  * `POST /v1/shopping-lists/:id/items`
  * `PATCH /v1/shopping-lists/:id/items/:itemId`
  * `DELETE /v1/shopping-lists/:id/items/:itemId`
* Price history search:

  * `GET /v1/shopping-lists/prices/search?name=...&store=...`
* Summary & alerts:

  * `GET /v1/shopping-lists/:id/summary`
* **Estimation** (only your data, with unit conversions kg↔g and l↔ml):

  * `POST /v1/shopping-lists/:id/estimate-prices`
    body: `{ strategy, store, days, onlyMissing }`
* **Meal plan → new list** (only items you previously purchased):

  * `POST /v1/shopping-lists/from-mealplan`
    body: `{ plan: { items: [...] }, allowUnknown, strategy, store, days }`

### Recipes (Spoonacular, optional)

* `GET /v1/recipes/search?q=...&number=...`
* `GET /v1/recipes/:id`
* `GET /v1/recipes/:id/nutrition`
  **Note:** If `SPOONACULAR_API_KEY` is not set, these return **501** with a friendly message.

### Stats & Dashboard

* Time series:

  * `GET /v1/stats/time-series?metric=volume&groupBy=day&from=...&to=...&tz=Europe/Lisbon&exerciseId=...`
* Period comparison:

  * `GET /v1/stats/compare?metric=sessions&fromA=...&toA=...&fromB=...&toB=...`
* PRs (Epley 1RM, best reps, best duration):

  * `GET /v1/stats/prs?exerciseId=...&limit=20`
* Top lists:

  * `GET /v1/stats/top?by=exercises|muscleGroups&metric=volume|duration|sessions&from=...&to=...&limit=10`
* Dashboard widgets:

  * `GET /v1/dashboard/widgets`
  * `PUT /v1/dashboard/widgets`
    body example:

    ```json
    {
      "widgets": [
        { "id": "w1", "type": "timeseries", "order": 0, "settings": { "metric": "volume", "groupBy": "day", "range": "last_30d" } },
        { "id": "w2", "type": "cards", "order": 1, "settings": { "show": ["sessions","duration"] } },
        { "id": "w3", "type": "top-list", "order": 2, "settings": { "by": "exercises", "metric": "volume", "limit": 5 } }
      ]
    }
    ```

---

## File Uploads (Media)

* Endpoint: `POST /v1/media/upload`
* Send as **multipart/form-data**:

  * `file` → the binary file (image/video)
  * `tags` → array of strings (use multiple `tags` fields or `tags[]`)
  * `albumId` → optional MongoID

**Common mistake:** using `application/json` for uploads. Always send **multipart/form-data**.

---

## Error Handling & Responses

* Standard HTTP errors via `@fastify/sensible`:

  * `reply.badRequest(...)`, `reply.unauthorized(...)`, `reply.notFound(...)`, etc.
* Validation:

  * **Zod** for body/query/params
  * Swagger schemas for documentation
* ObjectId format:

  * Must be a 24-char hex string: `^[a-fA-F0-9]{24}$`

---

## CORS

* **Development:** all origins are allowed.
* **Production:** set `CORS_ORIGINS` (comma-separated). Only listed origins are allowed.

---

## Security Notes

* Use a **strong `JWT_SECRET`** and rotate keys if needed.
* Run behind HTTPS (reverse proxy / ingress).
* Consider **rate-limiting** with `@fastify/rate-limit` in production.
* Avoid logging sensitive payloads in production.

---

## Performance & Indexing

* Existing helpful indexes:

  * `workout_logs`: `{ user: 1, date: -1 }`
* Optional indexes (large datasets):

  * `workout_logs`: `{ user: 1, 'entries.exercise': 1, date: -1 }`
* Aggregations in stats are optimized for user/date ranges and unwinded sets.

---

## Smoke Test Checklist (Swagger)

1. **Register → Login → Authorize**
2. **Exercises**: create a few (bench press, squat, plank).
3. **Workouts**: create with blocks referencing those exercises.
4. **Workout Logs**: create from workout; PUT full log; PATCH set/notes/finalize.
5. **Media**: upload a photo; add tags; move to album; create a comparison pair.
6. **Measurements**: create; attach progress photos; get progress.
7. **Shopping Lists**: create; add items; mark purchased with prices; get summary;
   run `estimate-prices`; create list from meal plan (only known items).
8. **Recipes** (optional): search/details/nutrition (requires API key).
9. **Stats**: time-series, compare, PRs, top;
   **Dashboard**: save and fetch widgets.

When all pass, you’re ready to ship **v1**.

---

## Roadmap (post-v1)

* Goals & Reminders (SMART goals, streaks, badges, push reminders)
* Timers (interval templates, history)
* More stats (reps, sets, RPE averages; PR history time-series)
* Background jobs (weekly digests, cleanup)
* E2E tests (Vitest + Supertest)
* Seed scripts & simple migrations

---

## Development Scripts

```bash
# dev
npm run dev
# start (prod)
npm start
# lint (if ESLint configured)
npm run lint
```

---

## License

Choose a license for your project (e.g., **MIT**) and add a `LICENSE` file.

---

## Troubleshooting

* **CORS error in browser** → Set `CORS_ORIGINS` correctly in production; in dev, all origins are allowed.
* **401 Unauthorized** → Missing/invalid Bearer token; login again and click “Authorize” in Swagger.
* **Multipart upload error** (“body must be object”) → Ensure `Content-Type: multipart/form-data` and field name `file`.
* **Cast to ObjectId failed** → IDs must be 24-char hex strings; check your params/body.
* **Spoonacular endpoints return 501** → Set `SPOONACULAR_API_KEY`.
* **OneSignal warnings** → Missing keys; pushes are NO-OP (safe to ignore in dev).