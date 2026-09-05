import { getPool } from "@/lib/db/client";
import { ImageUploadError } from "@/lib/images/limits";

export type ImageTarget = { kind: "profile" | "team"; id: string };

/** Lock the owner row so concurrent replacements each clean up the correct prior image. */
export async function replaceImage(target: ImageTarget, url: string | null): Promise<string | null> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const previous = await client.query<{ url: string | null }>(target.kind === "profile"
      ? "select avatar_url as url from app_user where id = $1 for update"
      : "select logo_url as url from fantasy_team where id = $1 for update", [target.id]);
    if (!previous.rows.length) throw new ImageUploadError("Image owner not found.", 404);
    await client.query(target.kind === "profile"
      ? "update app_user set avatar_url = $2, avatar_custom = true, updated_at = now() where id = $1"
      : "update fantasy_team set logo_url = $2, updated_at = now() where id = $1", [target.id, url]);
    await client.query("commit");
    return previous.rows[0].url;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
