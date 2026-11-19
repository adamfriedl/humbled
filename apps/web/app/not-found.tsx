import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="font-serif text-2xl font-bold">This page has been restructured.</h1>
      <p className="mt-2 text-muted">
        It wasn&apos;t a layoff. It was a strategic realignment of URLs.
      </p>
      <Link href="/" className="mt-6 inline-block underline hover:text-pie">
        Back to the feed
      </Link>
    </div>
  );
}
