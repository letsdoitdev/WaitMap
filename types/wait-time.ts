export interface WaitTime {
  restaurantId: string;
  predictedMinutes: number | null;
  confidenceTier: "high" | "medium" | "low" | "none";
  displayText: string;
  color: "green" | "blue" | "orange" | "red" | "gray";
  predictedAt: string;
  source: "google_direct" | "calculated" | "historical" | "none";
}
