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
export type Profile = Tables<"profiles">;
