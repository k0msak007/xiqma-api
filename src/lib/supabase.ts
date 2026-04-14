import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_KEY || "";

export const supabase = createClient(supabaseUrl, supabaseKey);

export const AVATARS_BUCKET = process.env.SUPABASE_AVATARS_BUCKET || "avatars";
export const ATTACHMENTS_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "task-attachments";