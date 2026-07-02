import { z } from "zod";
import { getPool, query, tryDatabase } from "@/lib/db/client";

export const demoUserEmail = "alex@example.local";
export const displayModes = ["auto", "light", "dark"] as const;

export const profilePreferenceUpdateSchema = z.object({
  displayName: z.string().trim().min(1, "Display name is required.").max(80, "Display name is too long."),
  timeZone: z.string().trim().min(1, "Time zone is required.").max(80, "Time zone is too long."),
  displayMode: z.enum(displayModes),
  notifications: z.object({
    injuries: z.boolean(),
    trades: z.boolean(),
    waivers: z.boolean(),
    lineupAlerts: z.boolean(),
  }),
});

export type DisplayMode = (typeof displayModes)[number];
export type ProfilePreferenceUpdate = z.infer<typeof profilePreferenceUpdateSchema>;

export type UserProfilePreferences = ProfilePreferenceUpdate & {
  userId: string;
  email: string;
  avatarUrl: string | null;
};

type ProfilePreferenceRow = {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  time_zone: string | null;
  notification_settings: unknown;
};

const defaultProfilePreferences: UserProfilePreferences = {
  userId: "demo-user",
  email: demoUserEmail,
  displayName: "Alex",
  avatarUrl: null,
  timeZone: "America/Los_Angeles",
  displayMode: "auto",
  notifications: {
    injuries: true,
    trades: true,
    waivers: true,
    lineupAlerts: false,
  },
};

function booleanSetting(settings: Record<string, unknown>, key: string, fallback: boolean) {
  return typeof settings[key] === "boolean" ? settings[key] : fallback;
}

function displayModeSetting(settings: Record<string, unknown>) {
  return displayModes.includes(settings.displayMode as DisplayMode) ? (settings.displayMode as DisplayMode) : "auto";
}

function normalizeNotificationSettings(settings: unknown): ProfilePreferenceUpdate["notifications"] & { displayMode: DisplayMode } {
  const source = settings && typeof settings === "object" && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {};

  return {
    injuries: booleanSetting(source, "injuries", true),
    trades: booleanSetting(source, "trades", true),
    waivers: booleanSetting(source, "waivers", true),
    lineupAlerts: booleanSetting(source, "lineupAlerts", false),
    displayMode: displayModeSetting(source),
  };
}

function mapProfilePreferences(row: ProfilePreferenceRow): UserProfilePreferences {
  const normalizedSettings = normalizeNotificationSettings(row.notification_settings);

  return {
    userId: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    timeZone: row.time_zone ?? defaultProfilePreferences.timeZone,
    displayMode: normalizedSettings.displayMode,
    notifications: {
      injuries: normalizedSettings.injuries,
      trades: normalizedSettings.trades,
      waivers: normalizedSettings.waivers,
      lineupAlerts: normalizedSettings.lineupAlerts,
    },
  };
}

export async function getProfilePreferences(email = demoUserEmail) {
  return tryDatabase(
    async () => {
      const result = await query<ProfilePreferenceRow>(
        `select u.id, u.email, u.display_name, u.avatar_url, p.time_zone, p.notification_settings
         from app_user u
         left join user_preference p on p.user_id = u.id
         where u.email = $1
         limit 1`,
        [email],
      );

      return result.rows[0] ? mapProfilePreferences(result.rows[0]) : defaultProfilePreferences;
    },
    () => defaultProfilePreferences,
  );
}

export async function updateProfilePreferences(input: ProfilePreferenceUpdate, email = demoUserEmail) {
  return tryDatabase(
    async () => {
      const pool = getPool();
      const client = await pool.connect();

      try {
        await client.query("begin");

        const userResult = await client.query<Pick<ProfilePreferenceRow, "id" | "email" | "display_name" | "avatar_url">>(
          `insert into app_user (email, display_name)
           values ($1, $2)
           on conflict (email) do update set display_name = excluded.display_name, updated_at = now()
           returning id, email, display_name, avatar_url`,
          [email, input.displayName],
        );

        const user = userResult.rows[0];
        const notificationSettings = {
          ...input.notifications,
          displayMode: input.displayMode,
        };

        const preferenceResult = await client.query<Pick<ProfilePreferenceRow, "time_zone" | "notification_settings">>(
          `insert into user_preference (user_id, time_zone, notification_settings)
           values ($1, $2, $3::jsonb)
           on conflict (user_id) do update set
             time_zone = excluded.time_zone,
             notification_settings = user_preference.notification_settings || excluded.notification_settings,
             updated_at = now()
           returning time_zone, notification_settings`,
          [user.id, input.timeZone, JSON.stringify(notificationSettings)],
        );

        await client.query("commit");

        return mapProfilePreferences({
          ...user,
          time_zone: preferenceResult.rows[0].time_zone,
          notification_settings: preferenceResult.rows[0].notification_settings,
        });
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    () => ({
      ...defaultProfilePreferences,
      ...input,
    }),
  );
}
