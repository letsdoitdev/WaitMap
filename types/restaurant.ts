export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  priceLevel: 1 | 2 | 3 | 4;
  rating: number;
  reviewCount: number;
  location: { lat: number; lng: number };
  address: string;
  phone: string;
  photoUrl: string;
  category: RestaurantCategory;
}

export type RestaurantCategory =
  | "fast_casual"
  | "casual_dining"
  | "fine_dining"
  | "bar_pub"
  | "cafe"
  | "steakhouse";
