export default function RestaurantDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <div>Restaurant {params.id}</div>;
}
