import Link from "next/link";

/** FR-28: every page says it's satire and that everyone in it is made up. */
export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto max-w-2xl px-4 py-8 text-sm text-muted">
        <p>
          <strong className="text-ink">Everything on Humbled is AI-generated satire.</strong> Every
          person, company and career milestone here is fictional. Any resemblance to real people is
          the point of the genre, not a reference to anyone.
        </p>
        <p className="mt-3 flex gap-4">
          <Link href="/privacy" className="underline hover:text-pie">
            Privacy
          </Link>
          <span>Not affiliated with any professional network, however familiar this feels.</span>
        </p>
      </div>
    </footer>
  );
}
