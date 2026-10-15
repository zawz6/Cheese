import { fetchJson, clip, yearOf } from "./http";
import { ProviderError, type ItemDraft, type Provider, type Ref } from "./types";

const BASE = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w342";

function auth(): { headers: Record<string, string>; query: string } {
  const key = process.env.TMDB_API_KEY ?? "";
  // A v4 read access token is a long JWT; a v3 key is 32 hex characters.
  if (key.startsWith("eyJ")) return { headers: { Authorization: `Bearer ${key}` }, query: "" };
  return { headers: {}, query: `&api_key=${encodeURIComponent(key)}` };
}

type SearchResp = {
  results: {
    id: number;
    media_type: "movie" | "tv" | "person";
    title?: string;
    name?: string;
    release_date?: string;
    first_air_date?: string;
    poster_path?: string | null;
    overview?: string;
  }[];
};

type Genre = { name: string };
type MovieResp = {
  id: number;
  title: string;
  release_date?: string;
  poster_path?: string | null;
  overview?: string;
  runtime?: number | null;
  genres?: Genre[];
  credits?: { crew?: { job: string; name: string }[] };
};
type TvResp = {
  id: number;
  name: string;
  first_air_date?: string;
  poster_path?: string | null;
  overview?: string;
  number_of_episodes?: number | null;
  episode_run_time?: number[];
  last_episode_to_air?: { runtime?: number | null } | null;
  genres?: Genre[];
  created_by?: { name: string }[];
};

function movieDraft(m: MovieResp): ItemDraft {
  return {
    category: "movie",
    source: "tmdb",
    externalId: `movie/${m.id}`,
    title: m.title,
    creator: m.credits?.crew?.find((c) => c.job === "Director")?.name ?? null,
    year: yearOf(m.release_date),
    coverUrl: m.poster_path ? IMG + m.poster_path : null,
    summary: clip(m.overview),
    unit: "watch",
    totalUnits: 1,
    unitSeconds: m.runtime ? m.runtime * 60 : null,
    genres: (m.genres ?? []).map((g) => g.name),
    platforms: [],
  };
}

function tvDraft(t: TvResp): ItemDraft {
  const runtime = t.episode_run_time?.find((n) => n > 0) ?? t.last_episode_to_air?.runtime ?? null;
  return {
    category: "series",
    source: "tmdb",
    externalId: `tv/${t.id}`,
    title: t.name,
    creator: t.created_by?.[0]?.name ?? null,
    year: yearOf(t.first_air_date),
    coverUrl: t.poster_path ? IMG + t.poster_path : null,
    summary: clip(t.overview),
    unit: "episode",
    totalUnits: t.number_of_episodes || null,
    unitSeconds: runtime ? runtime * 60 : null,
    genres: (t.genres ?? []).map((g) => g.name),
    platforms: [],
  };
}

export const tmdb: Provider = {
  source: "tmdb",
  categories: ["movie", "series"],
  enabled: () => Boolean(process.env.TMDB_API_KEY),

  async search(query, signal) {
    const a = auth();
    const url = `${BASE}/search/multi?query=${encodeURIComponent(query)}&include_adult=false&language=en-US${a.query}`;
    const data = await fetchJson<SearchResp>("TMDB", url, { headers: a.headers }, signal);
    const out: ItemDraft[] = [];
    for (const r of data.results ?? []) {
      if (r.media_type === "movie" && r.title) {
        out.push(
          movieDraft({ id: r.id, title: r.title, release_date: r.release_date, poster_path: r.poster_path, overview: r.overview }),
        );
      } else if (r.media_type === "tv" && r.name) {
        out.push(tvDraft({ id: r.id, name: r.name, first_air_date: r.first_air_date, poster_path: r.poster_path, overview: r.overview }));
      }
    }
    return out;
  },

  async popular(signal) {
    const a = auth();
    const url = `${BASE}/trending/all/week?language=en-US${a.query}`;
    const data = await fetchJson<SearchResp>("TMDB", url, { headers: a.headers }, signal);
    const out: ItemDraft[] = [];
    for (const r of data.results ?? []) {
      if (r.media_type === "movie" && r.title) {
        out.push(movieDraft({ id: r.id, title: r.title, release_date: r.release_date, poster_path: r.poster_path, overview: r.overview }));
      } else if (r.media_type === "tv" && r.name) {
        out.push(tvDraft({ id: r.id, name: r.name, first_air_date: r.first_air_date, poster_path: r.poster_path, overview: r.overview }));
      }
    }
    return out;
  },

  async details(ref: Ref, signal) {
    const m = ref.externalId.match(/^(movie|tv)\/(\d+)$/);
    if (!m) throw new ProviderError("TMDB", `bad id ${ref.externalId}`);
    const a = auth();
    const extra = m[1] === "movie" ? "&append_to_response=credits" : "";
    const url = `${BASE}/${m[1]}/${m[2]}?language=en-US${extra}${a.query}`;
    const data = await fetchJson<MovieResp & TvResp>("TMDB", url, { headers: a.headers }, signal);
    return m[1] === "movie" ? movieDraft(data) : tvDraft(data);
  },
};

export type WatchProviders = {
  region: string;
  /** Subscription services that stream it in this region, as TMDB names them. */
  streaming: string[];
  /** TMDB's page for the title in this region (which carries the JustWatch credit). */
  link: string | null;
};

type WatchResp = { results?: Record<string, { link?: string; flatrate?: { provider_name: string }[] }> };

/** Where a movie or series streams in a region. Null when TMDB has nothing for that region. Cached for a day. */
export async function watchProviders(externalId: string, region: string, signal: AbortSignal): Promise<WatchProviders | null> {
  const m = externalId.match(/^(movie|tv)\/(\d+)$/);
  if (!m || !/^[A-Z]{2}$/.test(region)) return null;
  const a = auth();
  const url = `${BASE}/${m[1]}/${m[2]}/watch/providers?${a.query.slice(1)}`;
  const data = await fetchJson<WatchResp>("TMDB", url, { headers: a.headers }, signal, { cacheMs: 24 * 3600_000 });
  const here = data.results?.[region];
  const streaming = [...new Set((here?.flatrate ?? []).map((p) => p.provider_name))];
  return streaming.length ? { region, streaming, link: here?.link ?? null } : null;
}
