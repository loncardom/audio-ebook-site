const GOOGLE_BOOKS_API_KEY =
  import.meta.env.VITE_GOOGLE_BOOKS_API_KEY ?? "AIzaSyD51MBfxddqgSSn8RH--hzS1HSB7i0bHm0";

export type GoogleBookMetadata = {
  title: string | null;
  authors: string[];
  description: string | null;
  coverUrl: string | null;
  publisher: string | null;
  publishedDate: string | null;
};

type GoogleBooksResponse = {
  items?: Array<{
    id?: string;
    volumeInfo?: {
      title?: string;
      authors?: string[];
      description?: string;
      publisher?: string;
      publishedDate?: string;
      imageLinks?: {
        thumbnail?: string;
        smallThumbnail?: string;
      };
    };
  }>;
};

function normalizeCoverUrl(url: string | null | undefined, volumeId?: string): string | null {
  if (volumeId) {
    return `https://books.google.com/books/publisher/content/images/frontcover/${volumeId}?fife=w400-h600&source=gbs_api`;
  }

  if (!url) {
    return null;
  }

  return url.replace(/^http:\/\//i, "https://");
}

export async function fetchGoogleBookMetadata(
  title: string | null,
  author: string | null
): Promise<GoogleBookMetadata | null> {
  const trimmedTitle = title?.trim();
  if (!trimmedTitle) {
    return null;
  }

  const q = [
    `intitle:${trimmedTitle}`,
    author?.trim() ? `inauthor:${author.trim()}` : null
  ]
    .filter(Boolean)
    .join(" ");

  const params = new URLSearchParams({
    q,
    printType: "books",
    langRestrict: "en",
    key: GOOGLE_BOOKS_API_KEY
  });

  const response = await fetch(`https://www.googleapis.com/books/v1/volumes?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Google Books lookup failed with status ${response.status}`);
  }

  const payload = (await response.json()) as GoogleBooksResponse;
  const item = payload.items?.[0];
  if (!item?.volumeInfo) {
    return null;
  }

  return {
    title: item.volumeInfo.title ?? trimmedTitle,
    authors: item.volumeInfo.authors ?? (author ? [author] : []),
    description: item.volumeInfo.description ?? null,
    coverUrl: normalizeCoverUrl(
      item.volumeInfo.imageLinks?.thumbnail ?? item.volumeInfo.imageLinks?.smallThumbnail,
      item.id
    ),
    publisher: item.volumeInfo.publisher ?? null,
    publishedDate: item.volumeInfo.publishedDate ?? null
  };
}
