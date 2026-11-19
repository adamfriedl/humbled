import Link from "next/link";

export function FeedTabs({ active }: { active: "latest" | "trending" }) {
  const tab = (key: "latest" | "trending", href: string, label: string) => (
    <Link
      href={href}
      aria-current={active === key ? "page" : undefined}
      className={`rounded-full px-4 py-1.5 text-sm ${
        active === key ? "bg-ink text-paper" : "text-muted hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <nav className="mb-5 flex gap-2" aria-label="Feed">
      {tab("latest", "/", "Latest")}
      {tab("trending", "/trending", "Trending")}
    </nav>
  );
}
