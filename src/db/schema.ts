import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export * from "./auth-schema";

const tz = (name: string) => timestamp(name, { withTimezone: true });
const id = () => uuid("id").primaryKey().defaultRandom();
const userRef = (name: string) => text(name).notNull().references(() => user.id, { onDelete: "cascade" });

export const CATEGORIES = ["movie", "series", "anime", "manga", "book", "game"] as const;
export const STATUSES = ["want", "in_progress", "paused", "done", "dropped"] as const;
export const PRIORITIES = ["must", "someday"] as const;
export const SOURCES = ["tmdb", "anilist", "openlibrary", "googlebooks", "igdb", "manual"] as const;
export const UNITS = ["watch", "episode", "chapter", "page", "minute"] as const;
export const RSVPS = ["going", "maybe", "cant"] as const;
export const NIGHT_STATUSES = ["voting", "set", "done", "cancelled"] as const;

export const categoryEnum = pgEnum("category", CATEGORIES);
export const statusEnum = pgEnum("entry_status", STATUSES);
export const priorityEnum = pgEnum("priority", PRIORITIES);
export const sourceEnum = pgEnum("item_source", SOURCES);
export const unitEnum = pgEnum("progress_unit", UNITS);
export const rsvpEnum = pgEnum("rsvp", RSVPS);
export const nightStatusEnum = pgEnum("night_status", NIGHT_STATUSES);
export const overrideKindEnum = pgEnum("override_kind", ["add", "block"]);
export const friendStatusEnum = pgEnum("friend_status", ["pending", "accepted"]);

export type Category = (typeof CATEGORIES)[number];
export type Source = (typeof SOURCES)[number];
export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Unit = (typeof UNITS)[number];
export type Rsvp = (typeof RSVPS)[number];

/* ---------- People ---------- */

export const profile = pgTable(
  "profile",
  {
    userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
    username: text("username").notNull().unique(),
    displayName: text("display_name").notNull(),
    avatarTone: smallint("avatar_tone").notNull().default(1),
    weeklyGoalMinutes: integer("weekly_goal_minutes").notNull().default(360),
    // How long before a session a reminder is sent. 0 turns reminders off.
    reminderLeadMin: smallint("reminder_lead_min").notNull().default(30),
    timezone: text("timezone").notNull().default("UTC"),
    icsToken: text("ics_token").notNull().unique(),
    inviteCode: text("invite_code").notNull().unique(),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("profile_avatar_tone", sql`${t.avatarTone} between 1 and 4`),
    check("profile_reminder_lead", sql`${t.reminderLeadMin} in (0, 15, 30, 60)`),
  ],
);

/* ---------- Catalog ---------- */

export const item = pgTable(
  "item",
  {
    id: id(),
    category: categoryEnum("category").notNull(),
    source: sourceEnum("source").notNull(),
    externalId: text("external_id"),
    title: text("title").notNull(),
    creator: text("creator"),
    year: integer("year"),
    coverUrl: text("cover_url"),
    summary: text("summary"),
    // Progress is counted in `unit`. totalUnits is null when the length is unknown.
    unit: unitEnum("unit").notNull(),
    totalUnits: integer("total_units"),
    unitSeconds: integer("unit_seconds"),
    genres: text("genres").array().notNull().default(sql`'{}'::text[]`),
    platforms: text("platforms").array().notNull().default(sql`'{}'::text[]`),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("item_source_external_uq").on(t.source, t.externalId).where(sql`${t.externalId} is not null`),
    index("item_category_idx").on(t.category),
  ],
);

export const entry = pgTable(
  "entry",
  {
    id: id(),
    userId: userRef("user_id"),
    itemId: uuid("item_id").notNull().references(() => item.id, { onDelete: "cascade" }),
    status: statusEnum("status").notNull().default("want"),
    priority: priorityEnum("priority").notNull().default("someday"),
    together: boolean("together").notNull().default(false),
    hidden: boolean("hidden").notNull().default(false),
    progress: integer("progress").notNull().default(0),
    // Rating in half stars: 1 = 0.5 stars, 10 = 5 stars.
    ratingHalf: smallint("rating_half"),
    review: text("review"),
    platform: text("platform"),
    // Lets someone set the length themselves when the catalog does not know it.
    totalOverride: integer("total_override"),
    wouldRedo: boolean("would_redo").notNull().default(false),
    startedAt: tz("started_at"),
    finishedAt: tz("finished_at"),
    lastProgressAt: tz("last_progress_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("entry_user_item_uq").on(t.userId, t.itemId),
    index("entry_user_status_idx").on(t.userId, t.status),
    index("entry_item_idx").on(t.itemId),
    check("entry_rating_range", sql`${t.ratingHalf} is null or ${t.ratingHalf} between 1 and 10`),
    check("entry_progress_nonneg", sql`${t.progress} >= 0`),
  ],
);

// An earlier, finished run of the same item. Starting something again after finishing it files the old run here
// before progress goes back to zero, so rewatches and rereads keep their dates, rating and review.
export const entryRun = pgTable(
  "entry_run",
  {
    id: id(),
    entryId: uuid("entry_id").notNull().references(() => entry.id, { onDelete: "cascade" }),
    startedAt: tz("started_at"),
    finishedAt: tz("finished_at").notNull(),
    ratingHalf: smallint("rating_half"),
    review: text("review"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("entry_run_entry_idx").on(t.entryId, t.finishedAt),
    check("entry_run_rating_range", sql`${t.ratingHalf} is null or ${t.ratingHalf} between 1 and 10`),
  ],
);

/* ---------- Time actually spent ---------- */

// One row per tap of a progress button. Feeds the weekly goal now and streaks and recaps later.
export const progressLog = pgTable(
  "progress_log",
  {
    id: id(),
    userId: userRef("user_id"),
    entryId: uuid("entry_id").references(() => entry.id, { onDelete: "set null" }),
    at: tz("at").notNull().defaultNow(),
    deltaUnits: integer("delta_units").notNull(),
    // Minutes this tap is worth. Negative when someone undoes a tap.
    minutes: integer("minutes").notNull(),
  },
  (t) => [index("progress_log_user_at_idx").on(t.userId, t.at), index("progress_log_entry_idx").on(t.entryId)],
);

/* ---------- Free time and sessions ---------- */

export const freeWindow = pgTable(
  "free_window",
  {
    id: id(),
    userId: userRef("user_id"),
    weekday: smallint("weekday").notNull(), // 0 = Sunday
    startMin: smallint("start_min").notNull(), // minutes after local midnight
    endMin: smallint("end_min").notNull(),
  },
  (t) => [
    index("free_window_user_idx").on(t.userId),
    check("free_window_weekday", sql`${t.weekday} between 0 and 6`),
    check("free_window_range", sql`${t.startMin} >= 0 and ${t.endMin} <= 1440 and ${t.startMin} < ${t.endMin}`),
  ],
);

export const freeOverride = pgTable(
  "free_override",
  {
    id: id(),
    userId: userRef("user_id"),
    day: date("day", { mode: "string" }).notNull(), // local calendar date, YYYY-MM-DD
    kind: overrideKindEnum("kind").notNull(),
    startMin: smallint("start_min").notNull(),
    endMin: smallint("end_min").notNull(),
  },
  (t) => [
    index("free_override_user_day_idx").on(t.userId, t.day),
    check("free_override_range", sql`${t.startMin} >= 0 and ${t.endMin} <= 1440 and ${t.startMin} < ${t.endMin}`),
  ],
);

export const planSession = pgTable(
  "plan_session",
  {
    id: id(),
    userId: userRef("user_id"),
    itemId: uuid("item_id").references(() => item.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    category: categoryEnum("category"),
    startsAt: tz("starts_at").notNull(),
    durationMin: integer("duration_min").notNull(),
    // How many units (episodes, chapters, pages, minutes) this session is meant to cover.
    units: integer("units"),
    nightId: uuid("night_id").references(() => night.id, { onDelete: "set null" }),
    note: text("note"),
    done: boolean("done").notNull().default(false),
    remindedAt: tz("reminded_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("plan_session_user_start_idx").on(t.userId, t.startsAt),
    index("plan_session_night_idx").on(t.nightId),
    // The reminder job runs every few minutes and filters on exactly this; keeps it from scanning every session.
    index("plan_session_due_idx").on(t.startsAt).where(sql`${t.done} = false and ${t.remindedAt} is null`),
    check("plan_session_duration", sql`${t.durationMin} > 0`),
  ],
);

/* ---------- Friends and groups ---------- */

export const friendship = pgTable(
  "friendship",
  {
    id: id(),
    // The pair is stored once, ordered so userLow < userHigh.
    userLow: userRef("user_low"),
    userHigh: userRef("user_high"),
    status: friendStatusEnum("status").notNull().default("pending"),
    requestedBy: text("requested_by").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("friendship_pair_uq").on(t.userLow, t.userHigh),
    index("friendship_high_idx").on(t.userHigh),
    check("friendship_order", sql`${t.userLow} < ${t.userHigh}`),
  ],
);

export const friendGroup = pgTable(
  "friend_group",
  {
    id: id(),
    name: text("name").notNull(),
    ownerId: userRef("owner_id"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [index("friend_group_owner_idx").on(t.ownerId)],
);

export const groupMember = pgTable(
  "group_member",
  {
    groupId: uuid("group_id").notNull().references(() => friendGroup.id, { onDelete: "cascade" }),
    userId: userRef("user_id"),
    joinedAt: tz("joined_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] }), index("group_member_user_idx").on(t.userId)],
);

/* ---------- Nights (group plans with time votes) ---------- */

export const night = pgTable(
  "night",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => friendGroup.id, { onDelete: "cascade" }),
    hostId: userRef("host_id"),
    itemId: uuid("item_id").notNull().references(() => item.id, { onDelete: "cascade" }),
    status: nightStatusEnum("status").notNull().default("voting"),
    chosenOptionId: uuid("chosen_option_id"),
    // Episodes, chapters or similar covered by the night. Applied to everyone's progress when they mark it done.
    units: integer("units"),
    publicToken: text("public_token").notNull().unique(),
    note: text("note"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [index("night_group_idx").on(t.groupId), index("night_host_idx").on(t.hostId), index("night_item_idx").on(t.itemId)],
);

export const nightOption = pgTable(
  "night_option",
  {
    id: id(),
    nightId: uuid("night_id").notNull().references(() => night.id, { onDelete: "cascade" }),
    startsAt: tz("starts_at").notNull(),
    durationMin: integer("duration_min").notNull(),
  },
  (t) => [index("night_option_night_idx").on(t.nightId), check("night_option_duration", sql`${t.durationMin} > 0`)],
);

export const nightParticipant = pgTable(
  "night_participant",
  {
    id: id(),
    nightId: uuid("night_id").notNull().references(() => night.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    guestName: text("guest_name"),
    guestSecret: text("guest_secret"),
    rsvp: rsvpEnum("rsvp"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("night_participant_user_uq").on(t.nightId, t.userId).where(sql`${t.userId} is not null`),
    index("night_participant_night_idx").on(t.nightId),
    check("night_participant_who", sql`(${t.userId} is not null) <> (${t.guestName} is not null)`),
  ],
);

export const nightVote = pgTable(
  "night_vote",
  {
    optionId: uuid("option_id").notNull().references(() => nightOption.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id").notNull().references(() => nightParticipant.id, { onDelete: "cascade" }),
  },
  // The primary key serves lookups by option; this one serves removing a participant's votes.
  (t) => [primaryKey({ columns: [t.optionId, t.participantId] }), index("night_vote_participant_idx").on(t.participantId)],
);

/* ---------- Reminders ---------- */

export const pushSubscription = pgTable(
  "push_subscription",
  {
    id: id(),
    userId: userRef("user_id"),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [index("push_subscription_user_idx").on(t.userId)],
);

/* ---------- Notifications ---------- */

export const notification = pgTable(
  "notification",
  {
    id: id(),
    userId: userRef("user_id"),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    url: text("url"),
    readAt: tz("read_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [index("notification_user_idx").on(t.userId, t.createdAt)],
);
