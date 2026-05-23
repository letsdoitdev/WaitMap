/**
 * Hand-written types matching supabase/migrations/0001_init.sql.
 * Regenerate from the schema once the project has `supabase` CLI access:
 *   supabase gen types typescript --linked > lib/database.types.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type QuestEventType =
  | "started"
  | "paused"
  | "resumed"
  | "completed"
  | "abandoned";

export type QuestSource = "ai_generated" | "user_suggested";
export type QuestReaction = "cooked" | "mid" | "tuff" | "fire";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          timezone: string;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          timezone?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string | null;
          timezone?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      quests: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          description: string;
          category: string;
          spice: number;
          estimated_minutes: number | null;
          location_text: string | null;
          source: QuestSource;
          reaction: QuestReaction | null;
          generated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          description: string;
          category: string;
          spice: number;
          estimated_minutes?: number | null;
          location_text?: string | null;
          source?: QuestSource;
          reaction?: QuestReaction | null;
          generated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          description?: string;
          category?: string;
          spice?: number;
          estimated_minutes?: number | null;
          location_text?: string | null;
          source?: QuestSource;
          reaction?: QuestReaction | null;
          generated_at?: string;
        };
        Relationships: [];
      };
      quest_events: {
        Row: {
          id: string;
          quest_id: string;
          user_id: string;
          event_type: QuestEventType;
          created_at: string;
        };
        Insert: {
          id?: string;
          quest_id: string;
          user_id: string;
          event_type: QuestEventType;
          created_at?: string;
        };
        Update: {
          id?: string;
          quest_id?: string;
          user_id?: string;
          event_type?: QuestEventType;
          created_at?: string;
        };
        Relationships: [];
      };
      quest_media: {
        Row: {
          id: string;
          quest_id: string;
          quest_event_id: string;
          user_id: string;
          storage_path: string;
          mime_type: string;
          bytes: number;
          width: number | null;
          height: number | null;
          duration_ms: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          quest_id: string;
          quest_event_id: string;
          user_id: string;
          storage_path: string;
          mime_type: string;
          bytes: number;
          width?: number | null;
          height?: number | null;
          duration_ms?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          quest_id?: string;
          quest_event_id?: string;
          user_id?: string;
          storage_path?: string;
          mime_type?: string;
          bytes?: number;
          width?: number | null;
          height?: number | null;
          duration_ms?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      daily_generation_counter: {
        Row: {
          user_id: string;
          date: string;
          count: number;
        };
        Insert: {
          user_id: string;
          date: string;
          count?: number;
        };
        Update: {
          user_id?: string;
          date?: string;
          count?: number;
        };
        Relationships: [];
      };
    };
    Views: { [key: string]: never };
    Functions: {
      start_quest: {
        Args: {
          p_title: string;
          p_description: string;
          p_category: string;
          p_spice: number;
          p_estimated_minutes: number | null;
          p_location_text: string | null;
          p_source?: QuestSource;
        };
        Returns: string;
      };
      increment_daily_generation_counter: {
        Args: Record<string, never>;
        Returns: number;
      };
    };
    Enums: { [key: string]: never };
    CompositeTypes: { [key: string]: never };
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type Quest = Tables<"quests">;
export type QuestEvent = Tables<"quest_events">;
export type QuestMedia = Tables<"quest_media">;
export type Profile = Tables<"profiles">;

export const QUEST_MEDIA_BUCKET = "quest-media";
export const MAX_MEDIA_PER_COMPLETION = 4;
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_IMAGE_MIME = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
] as const;
export const ACCEPTED_VIDEO_MIME = ["video/mp4", "video/quicktime"] as const;
export const ACCEPTED_MEDIA_MIME = [
  ...ACCEPTED_IMAGE_MIME,
  ...ACCEPTED_VIDEO_MIME,
] as const;
export const IMAGE_COMPRESS_THRESHOLD_BYTES = 2 * 1024 * 1024;
