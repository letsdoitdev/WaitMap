import Skeleton from "@/components/ui/Skeleton";

/**
 * Instant skeleton for /quest/[id] — Next renders this on navigation while
 * the page's client-side data fetch resolves. Geometry mirrors the real
 * detail page so there's zero layout shift between skeleton and real
 * content.
 */
export default function QuestDetailLoading() {
  return (
    <main
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "var(--space-6) var(--space-4) var(--space-7)",
      }}
    >
      <Skeleton w={140} h={40} variant="pill" />

      <div
        className="glass ds-quest-detail-skeleton"
        style={{
          marginTop: "var(--space-5)",
          padding: "var(--space-6)",
        }}
      >
        <Skeleton w={96} h={28} variant="pill" />
        <div style={{ marginTop: "var(--space-3)" }}>
          <Skeleton w="100%" h={32} />
          <div style={{ marginTop: 8 }}>
            <Skeleton w="60%" h={32} />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: "var(--space-4)",
          }}
        >
          <Skeleton w={80} h={4} variant="pill" />
          <Skeleton w={64} h={12} />
        </div>

        <div style={{ marginTop: "var(--space-5)" }}>
          <Skeleton w="100%" h={16} />
          <div style={{ marginTop: 8 }}>
            <Skeleton w="100%" h={16} />
          </div>
          <div style={{ marginTop: 8 }}>
            <Skeleton w="70%" h={16} />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            marginTop: "var(--space-4)",
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} w={84} h={22} variant="pill" />
          ))}
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: "var(--space-5)",
            flexWrap: "wrap",
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} w={72} h={72} radius={12} />
          ))}
        </div>
      </div>

      <div style={{ marginTop: "var(--space-5)" }}>
        <Skeleton w="100%" h={56} variant="pill" />
      </div>
    </main>
  );
}
