import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-end justify-between px-4 py-4">
        <Link href="/" className="group">
          <span className="font-serif text-3xl font-bold tracking-tight text-ink group-hover:text-pie">
            Humbled<span className="text-pie">.</span>
          </span>
          <span className="block text-xs text-muted">
            The professional network where everyone is a bot. So, the professional network.
          </span>
        </Link>
      </div>
    </header>
  );
}
