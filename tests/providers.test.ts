import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDetails, rank, searchAll } from "@/lib/providers";
import { tmdb, watchProviders } from "@/lib/providers/tmdb";
import { regionFromAcceptLanguage, whereToWatch } from "@/lib/watch";
import { anilist } from "@/lib/providers/anilist";
import { books, mergeBookHits } from "@/lib/providers/books";
import { igdb, resetIgdbToken } from "@/lib/providers/igdb";
import { fetchJson, resetProviderCache } from "@/lib/providers/http";
import type { ItemDraft } from "@/lib/providers/types";
import { formatMinutes, remainingMinutes, totalMinutes } from "@/lib/length";

// The sample responses below are written from each API's documented response format.
// They were not captured from live servers (the build sandbox cannot reach them).

type Route = (url: string, init?: RequestInit) => unknown | Promise<unknown>;
let calls: { url: string; init?: RequestInit }[] = [];

function mockFetch(routes: Record<string, Route>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      for (const [pattern, handler] of Object.entries(routes)) {
        if (String(url).includes(pattern)) {
          const body = await handler(String(url), init);
          if (body instanceof Response) return body;
          return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
        }
      }
      return new Response("not found", { status: 404 });
    }),
  );
}

const signal = () => new AbortController().signal;

beforeEach(() => {
  vi.unstubAllEnvs();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetIgdbToken();
  resetProviderCache();
});

describe("TMDB", () => {
  it("is disabled without a key", () => {
    vi.stubEnv("TMDB_API_KEY", "");
    expect(tmdb.enabled()).toBe(false);
  });

  it("maps movie and tv search hits, skips people, and namespaces ids", async () => {
    vi.stubEnv("TMDB_API_KEY", "abc123");
    mockFetch({
      "/search/multi": () => ({
        results: [
          { id: 438631, media_type: "movie", title: "Dune", release_date: "2021-09-15", poster_path: "/d.jpg", overview: "A boy." },
          { id: 1396, media_type: "tv", name: "Breaking Bad", first_air_date: "2008-01-20", poster_path: null },
          { id: 9, media_type: "person", name: "Someone" },
        ],
      }),
    });
    const hits = await tmdb.search("dune", signal());
    expect(hits.map((h) => [h.category, h.externalId, h.title, h.year])).toEqual([
      ["movie", "movie/438631", "Dune", 2021],
      ["series", "tv/1396", "Breaking Bad", 2008],
    ]);
    expect(hits[0].coverUrl).toBe("https://image.tmdb.org/t/p/w342/d.jpg");
    expect(calls[0].url).toContain("api_key=abc123");
  });

  it("sends a v4 token as a bearer header", async () => {
    vi.stubEnv("TMDB_API_KEY", "eyJhbGciOi.payload.sig");
    mockFetch({ "/search/multi": () => ({ results: [] }) });
    await tmdb.search("x", signal());
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer eyJhbGciOi.payload.sig");
    expect(calls[0].url).not.toContain("api_key");
  });

  it("reads runtime and director for a movie", async () => {
    vi.stubEnv("TMDB_API_KEY", "k");
    mockFetch({
      "/movie/438631": () => ({
        id: 438631,
        title: "Dune",
        release_date: "2021-09-15",
        runtime: 155,
        genres: [{ name: "Science Fiction" }],
        credits: { crew: [{ job: "Producer", name: "A" }, { job: "Director", name: "Denis Villeneuve" }] },
      }),
    });
    const d = await fetchDetails({ source: "tmdb", externalId: "movie/438631", category: "movie" });
    expect(d).toMatchObject({ unit: "watch", totalUnits: 1, unitSeconds: 155 * 60, creator: "Denis Villeneuve", genres: ["Science Fiction"] });
  });

  it("reads episode count and falls back to last episode runtime for a series", async () => {
    vi.stubEnv("TMDB_API_KEY", "k");
    mockFetch({
      "/tv/157741": () => ({ id: 157741, name: "Dune: Prophecy", number_of_episodes: 6, episode_run_time: [], last_episode_to_air: { runtime: 58 }, created_by: [{ name: "Alison Schapker" }] }),
    });
    const d = await fetchDetails({ source: "tmdb", externalId: "tv/157741", category: "series" });
    expect(d).toMatchObject({ unit: "episode", totalUnits: 6, unitSeconds: 58 * 60, creator: "Alison Schapker" });
  });

  it("rejects malformed ids before calling the network", async () => {
    vi.stubEnv("TMDB_API_KEY", "k");
    mockFetch({});
    await expect(fetchDetails({ source: "tmdb", externalId: "movie/1;DROP", category: "movie" })).rejects.toThrow(/bad id/);
    expect(calls).toHaveLength(0);
  });

  it("refuses to hydrate into a different category than requested", async () => {
    vi.stubEnv("TMDB_API_KEY", "k");
    mockFetch({ "/movie/1": () => ({ id: 1, title: "X" }) });
    await expect(fetchDetails({ source: "tmdb", externalId: "movie/1", category: "series" })).rejects.toThrow(/category mismatch/);
  });
});

describe("TMDB watch providers", () => {
  const body = { results: { US: { link: "https://tmdb/us", flatrate: [{ provider_name: "Netflix" }, { provider_name: "Max" }, { provider_name: "Netflix" }], rent: [{ provider_name: "Apple TV" }] }, GB: { link: "https://tmdb/gb", rent: [{ provider_name: "Apple TV" }] } } };

  it("lists only subscription services for the region, without repeats", async () => {
    vi.stubEnv("TMDB_API_KEY", "abc123");
    mockFetch({ "/movie/157336/watch/providers": () => body });
    expect(await watchProviders("movie/157336", "US", signal())).toEqual({ region: "US", streaming: ["Netflix", "Max"], link: "https://tmdb/us" });
    expect(calls[0].url).toContain("api_key=abc123");
  });

  it("returns null when the region has no subscription service or no data", async () => {
    vi.stubEnv("TMDB_API_KEY", "abc123");
    mockFetch({ "/tv/1/watch/providers": () => body });
    expect(await watchProviders("tv/1", "GB", signal())).toBeNull();
    expect(await watchProviders("tv/1", "FR", signal())).toBeNull();
  });

  it("refuses ids and regions that are not what TMDB expects, without calling out", async () => {
    vi.stubEnv("TMDB_API_KEY", "abc123");
    mockFetch({});
    expect(await watchProviders("OL123W", "US", signal())).toBeNull();
    expect(await watchProviders("movie/1", "us/../x", signal())).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("whereToWatch only asks for TMDB titles, and swallows provider errors", async () => {
    vi.stubEnv("TMDB_API_KEY", "abc123");
    mockFetch({ "/watch/providers": () => new Response("down", { status: 500 }) });
    expect(await whereToWatch({ source: "igdb", externalId: "5" }, "US")).toBeNull();
    expect(await whereToWatch({ source: "tmdb", externalId: null }, "US")).toBeNull();
    expect(await whereToWatch({ source: "tmdb", externalId: "movie/9" }, "US")).toBeNull();
  });

  it("picks the region from the browser language", () => {
    expect(regionFromAcceptLanguage("en-GB,en;q=0.9")).toBe("GB");
    expect(regionFromAcceptLanguage("fr-ca;q=0.8, fr;q=0.5")).toBe("CA");
    expect(regionFromAcceptLanguage("en")).toBe("US");
    expect(regionFromAcceptLanguage(null)).toBe("US");
  });
});

describe("AniList", () => {
  const media = [
    {
      id: 154587,
      type: "ANIME",
      format: "TV",
      title: { romaji: "Sousou no Frieren", english: "Frieren: Beyond Journey's End" },
      startDate: { year: 2023 },
      coverImage: { large: "https://s4.anilist.co/f.jpg" },
      episodes: 28,
      duration: 24,
      genres: ["Adventure", "Fantasy"],
      description: "The mage<br>Frieren.",
      studios: { nodes: [{ name: "MADHOUSE" }] },
    },
    {
      id: 30013,
      type: "MANGA",
      format: "MANGA",
      title: { romaji: "Vinland Saga", english: null },
      startDate: { year: 2005 },
      coverImage: { large: "https://s4.anilist.co/v.jpg" },
      chapters: null,
      genres: ["Action"],
      staff: { edges: [{ role: "Art", node: { name: { full: "Makoto Yukimura" } } }, { role: "Story & Art", node: { name: { full: "Makoto Yukimura" } } }] },
    },
  ];

  it("maps anime and manga with their units", async () => {
    mockFetch({ "graphql.anilist.co": () => ({ data: { Page: { media } } }) });
    const [a, m] = await anilist.search("frieren", signal());
    expect(a).toMatchObject({ category: "anime", title: "Frieren: Beyond Journey's End", unit: "episode", totalUnits: 28, unitSeconds: 1440, creator: "MADHOUSE", summary: "The mage Frieren." });
    expect(m).toMatchObject({ category: "manga", title: "Vinland Saga", unit: "chapter", totalUnits: null, creator: "Makoto Yukimura" });
  });

  it("treats an anime movie as a single watch", async () => {
    mockFetch({ "graphql.anilist.co": () => ({ data: { Media: { ...media[0], format: "MOVIE", episodes: 1 } } }) });
    const d = await fetchDetails({ source: "anilist", externalId: "154587", category: "anime" });
    expect(d.totalUnits).toBe(1);
  });

  it("surfaces GraphQL errors", async () => {
    mockFetch({ "graphql.anilist.co": () => ({ errors: [{ message: "Too Many Requests" }] }) });
    await expect(anilist.search("x", signal())).rejects.toThrow(/Too Many Requests/);
  });
});

describe("Books", () => {
  const ol = {
    docs: [
      { key: "/works/OL893415W", title: "Dune", author_name: ["Frank Herbert"], first_publish_year: 1965, cover_i: 8231856, number_of_pages_median: 604, subject: ["Science fiction", "Dune (Imaginary place)"] },
      { key: "/authors/OL1A", title: "Not a work" },
    ],
  };
  const gb = {
    items: [
      { id: "B1fgwQEACAAJ", volumeInfo: { title: "Dune", authors: ["Frank Herbert"], publishedDate: "2005-08-02", pageCount: 528, imageLinks: { thumbnail: "http://books.google.com/x.jpg" } } },
      { id: "ZZZZZZ12", volumeInfo: { title: "Dune Messiah", authors: ["Frank Herbert"], pageCount: 331 } },
    ],
  };

  it("merges both sources: Open Library first, Google fills gaps, extra Google books kept", async () => {
    mockFetch({ "openlibrary.org/search.json": () => ol, "googleapis.com/books/v1/volumes?": () => gb });
    const hits = await books.search("dune", signal());
    expect(hits.map((h) => [h.source, h.title, h.totalUnits])).toEqual([
      ["openlibrary", "Dune", 604],
      ["googlebooks", "Dune Messiah", 331],
    ]);
  });

  it("still returns results when one source is down", async () => {
    mockFetch({ "openlibrary.org/search.json": () => new Response("x", { status: 503 }), "googleapis.com/books/v1/volumes?": () => gb });
    const hits = await books.search("dune", signal());
    expect(hits.length).toBe(2);
    expect(hits[0].source).toBe("googlebooks");
  });

  it("uses Google's page count and cover when Open Library has none", () => {
    const a: ItemDraft = { category: "book", source: "openlibrary", externalId: "OL1W", title: "Emma", creator: "Jane Austen", year: 1815, coverUrl: null, summary: null, unit: "page", totalUnits: null, unitSeconds: null, genres: [], platforms: [] };
    const b: ItemDraft = { ...a, source: "googlebooks", externalId: "g1", coverUrl: "https://c", totalUnits: 474 };
    const [m] = mergeBookHits([a], [b]);
    expect(m).toMatchObject({ source: "openlibrary", totalUnits: 474, coverUrl: "https://c" });
  });

  it("hydrates an Open Library work: median page count, authors, description object", async () => {
    mockFetch({
      "/works/OL893415W/editions.json": () => ({ entries: [{ number_of_pages: 604 }, { number_of_pages: 528 }, { number_of_pages: 12 }, { number_of_pages: 896 }, {}] }),
      "/works/OL893415W.json": () => ({ title: "Dune", description: { value: "Set on Arrakis." }, covers: [-1, 8231856], subjects: ["Science fiction"], first_publish_date: "1965", authors: [{ author: { key: "/authors/OL79034A" } }] }),
      "/authors/OL79034A.json": () => ({ name: "Frank Herbert" }),
    });
    const d = await fetchDetails({ source: "openlibrary", externalId: "OL893415W", category: "book" });
    expect(d).toMatchObject({ title: "Dune", creator: "Frank Herbert", year: 1965, totalUnits: 604, summary: "Set on Arrakis.", coverUrl: "https://covers.openlibrary.org/b/id/8231856-M.jpg" });
  });

  it("survives a failed editions lookup", async () => {
    mockFetch({
      "/editions.json": () => new Response("x", { status: 500 }),
      "/works/OL1W.json": () => ({ title: "Short", authors: [] }),
    });
    const d = await fetchDetails({ source: "openlibrary", externalId: "OL1W", category: "book" });
    expect(d.totalUnits).toBeNull();
  });

  it("hydrates a Google Books volume", async () => {
    mockFetch({ "/volumes/B1fgwQEACAAJ": () => gb.items[0] });
    const d = await fetchDetails({ source: "googlebooks", externalId: "B1fgwQEACAAJ", category: "book" });
    expect(d).toMatchObject({ source: "googlebooks", totalUnits: 528, coverUrl: "https://books.google.com/x.jpg" });
  });
});

describe("IGDB", () => {
  function igdbRoutes() {
    return {
      "id.twitch.tv/oauth2/token": () => ({ access_token: "tok", expires_in: 5000000 }),
      "api.igdb.com/v4/game_time_to_beats": () => [{ hastily: 36000, normally: 54000, completely: 108000 }],
      "api.igdb.com/v4/games": () => [
        {
          id: 119133,
          name: "Elden Ring",
          first_release_date: 1645747200,
          cover: { image_id: "co4jni" },
          genres: [{ name: "RPG" }],
          platforms: [{ name: "PC (Microsoft Windows)" }, { name: "PlayStation 5" }],
          involved_companies: [{ developer: false, company: { name: "Bandai Namco" } }, { developer: true, company: { name: "FromSoftware" } }],
        },
      ],
    };
  }

  it("is disabled without Twitch credentials", () => {
    vi.stubEnv("TWITCH_CLIENT_ID", "");
    expect(igdb.enabled()).toBe(false);
  });

  it("gets one token, caches it, and sends the right headers", async () => {
    vi.stubEnv("TWITCH_CLIENT_ID", "cid");
    vi.stubEnv("TWITCH_CLIENT_SECRET", "sec");
    mockFetch(igdbRoutes());
    await igdb.search("elden", signal());
    await igdb.search("elden ring", signal());
    expect(calls.filter((c) => c.url.includes("oauth2/token"))).toHaveLength(1);
    const api = calls.find((c) => c.url.endsWith("/games"))!;
    expect((api.init?.headers as Record<string, string>)["Client-ID"]).toBe("cid");
    expect((api.init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("maps a game with platforms, developer, year and cover", async () => {
    vi.stubEnv("TWITCH_CLIENT_ID", "cid");
    vi.stubEnv("TWITCH_CLIENT_SECRET", "sec");
    mockFetch(igdbRoutes());
    const [g] = await igdb.search("elden", signal());
    expect(g).toMatchObject({ category: "game", title: "Elden Ring", creator: "FromSoftware", year: 2022, unit: "minute", totalUnits: null, platforms: ["PC (Microsoft Windows)", "PlayStation 5"] });
    expect(g.coverUrl).toBe("https://images.igdb.com/igdb/image/upload/t_cover_big/co4jni.jpg");
  });

  it("uses time to beat on hydrate: 54000 s is 900 minutes", async () => {
    vi.stubEnv("TWITCH_CLIENT_ID", "cid");
    vi.stubEnv("TWITCH_CLIENT_SECRET", "sec");
    mockFetch(igdbRoutes());
    const d = await fetchDetails({ source: "igdb", externalId: "119133", category: "game" });
    expect(d.totalUnits).toBe(900);
    expect(totalMinutes(d)).toBe(900);
  });

  it("keeps the game when time to beat is missing", async () => {
    vi.stubEnv("TWITCH_CLIENT_ID", "cid");
    vi.stubEnv("TWITCH_CLIENT_SECRET", "sec");
    mockFetch({ ...igdbRoutes(), "api.igdb.com/v4/game_time_to_beats": () => [] });
    const d = await fetchDetails({ source: "igdb", externalId: "119133", category: "game" });
    expect(d.totalUnits).toBeNull();
  });

  it("does not let a trailing backslash escape the closing quote", async () => {
    vi.stubEnv("TWITCH_CLIENT_ID", "cid");
    vi.stubEnv("TWITCH_CLIENT_SECRET", "sec");
    mockFetch(igdbRoutes());
    await igdb.search("halo\\", signal());
    const body = String(calls.find((c) => c.url.endsWith("/games"))!.init?.body);
    expect(body).toMatch(/^search "halo "; fields/);
  });

  it("does not let quotes in a search break out of the query", async () => {
    vi.stubEnv("TWITCH_CLIENT_ID", "cid");
    vi.stubEnv("TWITCH_CLIENT_SECRET", "sec");
    mockFetch(igdbRoutes());
    await igdb.search('x"; where id = 1; "', signal());
    const body = String(calls.find((c) => c.url.endsWith("/games"))!.init?.body);
    const m = body.match(/^search "([^"]*)"; fields/);
    expect(m).not.toBeNull(); // the quoted search term ends exactly where we expect
    expect(m![1]).not.toMatch(/[";]/);
    const outside = body.replace(/^search "[^"]*"/, "");
    expect(outside.match(/where /g)).toHaveLength(1); // only our own where clause is outside the quotes
  });

  it("rejects non-numeric ids", async () => {
    vi.stubEnv("TWITCH_CLIENT_ID", "cid");
    vi.stubEnv("TWITCH_CLIENT_SECRET", "sec");
    mockFetch({});
    await expect(fetchDetails({ source: "igdb", externalId: "1; delete", category: "game" })).rejects.toThrow(/bad id/);
  });
});

describe("searchAll", () => {
  const draft = (title: string, category: ItemDraft["category"] = "movie"): ItemDraft => ({
    category, source: "tmdb", externalId: title, title, creator: null, year: null, coverUrl: null, summary: null, unit: "watch", totalUnits: 1, unitSeconds: null, genres: [], platforms: [],
  });

  it("ranks exact matches, then prefix, then contains", () => {
    const ranked = rank([draft("The Dune Book"), draft("Dune Messiah"), draft("Dune")], "dune").map((h) => h.title);
    expect(ranked).toEqual(["Dune", "Dune Messiah", "The Dune Book"]);
  });

  it("reports unconfigured categories as unavailable instead of failing", async () => {
    vi.stubEnv("TMDB_API_KEY", "");
    vi.stubEnv("TWITCH_CLIENT_ID", "");
    mockFetch({ "graphql.anilist.co": () => ({ data: { Page: { media: [] } } }), "openlibrary.org": () => ({ docs: [] }), "googleapis.com": () => ({ items: [] }) });
    const out = await searchAll("dune");
    expect(out.unavailable.sort()).toEqual(["game", "movie", "series"]);
    expect(out.failed).toEqual([]);
  });

  it("reports a failing provider and still returns the others", async () => {
    vi.stubEnv("TMDB_API_KEY", "k");
    vi.stubEnv("TWITCH_CLIENT_ID", "");
    mockFetch({
      "api.themoviedb.org": () => new Response("rate limited", { status: 429 }),
      "graphql.anilist.co": () => ({ data: { Page: { media: [{ id: 1, type: "ANIME", title: { romaji: "Dune Anime" }, episodes: 12 }] } } }),
      "openlibrary.org": () => ({ docs: [] }),
      "googleapis.com": () => ({ items: [] }),
    });
    const out = await searchAll("dune");
    expect(out.hits.map((h) => h.title)).toEqual(["Dune Anime"]);
    expect(out.failed.map((f) => f.provider)).toEqual(["tmdb"]);
  });

  it("filters to one category and does not call other providers", async () => {
    vi.stubEnv("TMDB_API_KEY", "k");
    mockFetch({ "api.themoviedb.org": () => ({ results: [{ id: 1, media_type: "movie", title: "Dune" }, { id: 2, media_type: "tv", name: "Dune TV" }] }) });
    const out = await searchAll("dune", "movie");
    expect(out.hits.map((h) => h.title)).toEqual(["Dune"]);
    expect(calls.every((c) => c.url.includes("themoviedb"))).toBe(true);
  });

  it("does not search for one-letter queries", async () => {
    mockFetch({});
    expect((await searchAll("d")).hits).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("length helpers", () => {
  const series = { unit: "episode" as const, totalUnits: 28, unitSeconds: 1440 };
  it("computes total and remaining minutes", () => {
    expect(totalMinutes(series)).toBe(672);
    expect(remainingMinutes(series, 8)).toBe(480);
    expect(remainingMinutes(series, 40)).toBe(0);
  });
  it("is null when the length is unknown, unless the person set it", () => {
    const manga = { unit: "chapter" as const, totalUnits: null, unitSeconds: null };
    expect(totalMinutes(manga)).toBeNull();
    expect(totalMinutes(manga, 100)).toBe(800);
  });
  it("estimates book pages at 90 seconds", () => {
    expect(totalMinutes({ unit: "page", totalUnits: 600, unitSeconds: null })).toBe(900);
  });
  it("formats durations", () => {
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(120)).toBe("2h");
    expect(formatMinutes(169)).toBe("2h 49m");
  });
});

describe("fetchJson", () => {
  const ok = () => new Response(JSON.stringify({ n: 1 }), { status: 200 });

  it("reuses an answer it already has, but not when asked not to", async () => {
    mockFetch({ "example.test/a": ok });
    await fetchJson("X", "https://example.test/a", {}, signal());
    await fetchJson("X", "https://example.test/a", {}, signal());
    expect(calls).toHaveLength(1);
    await fetchJson("X", "https://example.test/a", {}, signal(), { cacheMs: 0 });
    expect(calls).toHaveLength(2);
  });

  it("keeps different POST bodies apart", async () => {
    mockFetch({ "example.test/q": ok });
    await fetchJson("X", "https://example.test/q", { method: "POST", body: "one" }, signal());
    await fetchJson("X", "https://example.test/q", { method: "POST", body: "two" }, signal());
    expect(calls).toHaveLength(2);
  });

  it("retries a 503 once and returns the second answer", async () => {
    let n = 0;
    mockFetch({ "example.test/b": () => (++n === 1 ? new Response("x", { status: 503 }) : ok()) });
    expect(await fetchJson("X", "https://example.test/b", {}, signal())).toEqual({ n: 1 });
    expect(calls).toHaveLength(2);
  });

  it("gives up after one retry, does not cache the failure, and does not retry a 404", async () => {
    mockFetch({ "example.test/c": () => new Response("x", { status: 500 }) });
    await expect(fetchJson("X", "https://example.test/c", {}, signal())).rejects.toThrow(/HTTP 500/);
    expect(calls).toHaveLength(2);
    await expect(fetchJson("X", "https://example.test/c", {}, signal())).rejects.toThrow(/HTTP 500/);
    expect(calls).toHaveLength(4);
    mockFetch({});
    await expect(fetchJson("X", "https://example.test/missing", {}, signal())).rejects.toThrow(/HTTP 404/);
    expect(calls).toHaveLength(1);
  });

  it("does not retry once the caller has given up", async () => {
    const c = new AbortController();
    mockFetch({ "example.test/d": () => new Response("x", { status: 503 }) });
    c.abort();
    await expect(fetchJson("X", "https://example.test/d", {}, c.signal)).rejects.toThrow();
    expect(calls.length).toBeLessThanOrEqual(1);
  });
});
