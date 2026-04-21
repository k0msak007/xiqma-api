import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

export const AVATARS_BUCKET: string = process.env.SUPABASE_AVATARS_BUCKET ?? "avatars";
export const ATTACHMENTS_BUCKET: string = process.env.SUPABASE_STORAGE_BUCKET ?? "task-attachments";

export async function getSignedAvatarUrl(avatarUrl: string | null): Promise<string | null> {
  if (!avatarUrl) return null;
  
  try {
    // Extract the path from the public URL
    // URL format: https://mgquzuqyhpsrcbotcwfb.supabase.co/storage/v1/object/public/avatars/{path}
    const urlParts = avatarUrl.split("/object/public/avatars/");
    if (urlParts.length !== 2) return avatarUrl;
    
    const path = urlParts[1];
    if (!path) return avatarUrl;
    
    // Generate signed URL with 15 minute expiry
    const { data, error } = await supabase.storage
      .from(AVATARS_BUCKET as string)
      .createSignedUrl(path, 15 * 60);
    
    if (error || !data) return avatarUrl;
    
    return data.signedUrl;
  } catch {
    return avatarUrl;
  }
}