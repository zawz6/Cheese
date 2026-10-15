// Development aid only. Preload with NODE_OPTIONS="--import ./scripts/mock-apis.mjs" to answer the
// TMDB, AniList, Open Library, Google Books, Twitch and IGDB requests from a small built-in catalog.
// Used where the real APIs cannot be reached (offline machines, CI, this project's build sandbox).
// The response shapes follow each API's documented format.

const realFetch = globalThis.fetch;

const swatch = (hex) =>
  "data:image/svg+xml," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="${hex}"/></svg>`);

const CATALOG = [
  { k: "dune", title: "Dune", c: "#a2441f", movie: { id: 438631, year: "2021-09-15", runtime: 155, director: "Denis Villeneuve" }, book: { id: "OL893415W", year: 1965, author: "Frank Herbert", pages: 604 } },
  { k: "dune prophecy", title: "Dune: Prophecy", c: "#7a2f4a", tv: { id: 157741, year: "2024-11-17", eps: 6, runtime: 58, by: "Alison Schapker" } },
  { k: "dune spice wars", title: "Dune: Spice Wars", c: "#5c4c1e", game: { id: 130000, year: 2022, dev: "Shiro Games", hours: 30, platforms: ["PC (Microsoft Windows)"] } },
  { k: "frieren", title: "Frieren: Beyond Journey's End", c: "#5b4a9e", anime: { id: 154587, year: 2023, eps: 28, mins: 24, studio: "MADHOUSE" } },
  { k: "berserk", title: "Berserk", c: "#4a4f5c", manga: { id: 30002, year: 1989, chapters: 364, author: "Kentaro Miura" } },
  { k: "vinland saga", title: "Vinland Saga", c: "#2f6272", manga: { id: 30013, year: 2005, chapters: null, author: "Makoto Yukimura" }, anime: { id: 101348, year: 2019, eps: 24, mins: 24, studio: "WIT STUDIO" } },
  { k: "elden ring", title: "Elden Ring", c: "#6b5a2c", game: { id: 119133, year: 2022, dev: "FromSoftware", hours: 55, platforms: ["PC (Microsoft Windows)", "PlayStation 5", "Xbox Series X|S"] } },
  { k: "it takes two", title: "It Takes Two", c: "#3f6b33", game: { id: 126459, year: 2021, dev: "Hazelight", hours: 12, platforms: ["PC (Microsoft Windows)", "PlayStation 5"] } },
  { k: "hades", title: "Hades", c: "#7a2f4a", game: { id: 113112, year: 2020, dev: "Supergiant Games", hours: 22, platforms: ["PC (Microsoft Windows)", "Nintendo Switch"] } },
  { k: "severance", title: "Severance", c: "#2f6272", tv: { id: 95396, year: "2022-02-17", eps: 19, runtime: 50, by: "Dan Erickson" } },
  { k: "interstellar", title: "Interstellar", c: "#1d3a68", movie: { id: 157336, year: "2014-11-05", runtime: 169, director: "Christopher Nolan" } },
  { k: "perfect days", title: "Perfect Days", c: "#3f6b33", movie: { id: 976893, year: "2023-12-22", runtime: 124, director: "Wim Wenders" } },
  { k: "spirited away", title: "Spirited Away", c: "#5b4a9e", movie: { id: 129, year: "2001-07-20", runtime: 125, director: "Hayao Miyazaki" } },
];

const find = (q) => {
  const s = q.toLowerCase();
  return CATALOG.filter((e) => e.k.includes(s) || s.includes(e.k) || e.title.toLowerCase().includes(s));
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const tmdbSearch = (q) => ({
  results: find(q).flatMap((e) => [
    e.movie && { id: e.movie.id, media_type: "movie", title: e.title, release_date: e.movie.year, poster_path: null, overview: `${e.title} (sample data).` },
    e.tv && { id: e.tv.id, media_type: "tv", name: e.title, first_air_date: e.tv.year, poster_path: null },
  ]).filter(Boolean),
});

const anilistMedia = (e, type) => {
  const x = e[type];
  return {
    id: x.id, type: type.toUpperCase(), format: "TV", title: { romaji: e.title, english: e.title }, startDate: { year: x.year },
    coverImage: { large: swatch(e.c) }, episodes: x.eps ?? null, duration: x.mins ?? null, chapters: x.chapters ?? null,
    genres: ["Fantasy"], description: `${e.title} (sample data).`,
    studios: { nodes: x.studio ? [{ name: x.studio }] : [] },
    staff: { edges: x.author ? [{ role: "Story & Art", node: { name: { full: x.author } } }] : [] },
  };
};

const routes = [
  [/api\.themoviedb\.org\/3\/search\/multi\?query=([^&]*)/, (m) => json(tmdbSearch(decodeURIComponent(m[1])))],
  [/api\.themoviedb\.org\/3\/(movie|tv)\/(\d+)\/watch\/providers/, (m) => json({ id: Number(m[2]), results: { US: { link: `https://www.themoviedb.org/${m[1]}/${m[2]}/watch?locale=US`, flatrate: [{ provider_name: "Netflix" }, { provider_name: "Max" }], rent: [{ provider_name: "Apple TV" }] }, GB: { link: "https://www.themoviedb.org", rent: [{ provider_name: "Apple TV" }] } } })],
  [/api\.themoviedb\.org\/3\/(movie|tv)\/(\d+)\/watch\/providers/, (m) => json({ id: Number(m[2]), results: { US: { link: `https://www.themoviedb.org/${m[1]}/${m[2]}/watch?locale=US`, flatrate: [{ provider_name: "Netflix" }, { provider_name: "Max" }], rent: [{ provider_name: "Apple TV" }] }, GB: { link: "https://www.themoviedb.org", rent: [{ provider_name: "Apple TV" }] } } })],
  [/api\.themoviedb\.org\/3\/movie\/(\d+)/, (m) => {
    const e = CATALOG.find((c) => c.movie?.id === Number(m[1]));
    return e ? json({ id: e.movie.id, title: e.title, release_date: e.movie.year, runtime: e.movie.runtime, overview: `${e.title} (sample data).`, genres: [{ name: "Drama" }], credits: { crew: [{ job: "Director", name: e.movie.director }] } }) : json({}, 404);
  }],
  [/api\.themoviedb\.org\/3\/tv\/(\d+)/, (m) => {
    const e = CATALOG.find((c) => c.tv?.id === Number(m[1]));
    return e ? json({ id: e.tv.id, name: e.title, first_air_date: e.tv.year, number_of_episodes: e.tv.eps, episode_run_time: [e.tv.runtime], genres: [{ name: "Drama" }], created_by: [{ name: e.tv.by }] }) : json({}, 404);
  }],
  [/graphql\.anilist\.co/, async (_m, init) => {
    const { query, variables } = JSON.parse(init.body);
    if (query.includes("Page(")) {
      const media = find(variables.q).flatMap((e) => [e.anime && anilistMedia(e, "anime"), e.manga && anilistMedia(e, "manga")]).filter(Boolean);
      return json({ data: { Page: { media } } });
    }
    for (const e of CATALOG) for (const t of ["anime", "manga"]) if (e[t]?.id === variables.id) return json({ data: { Media: anilistMedia(e, t) } });
    return json({ errors: [{ message: "Not Found." }] }, 404);
  }],
  [/openlibrary\.org\/search\.json\?q=([^&]*)/, (m) => json({ docs: find(decodeURIComponent(m[1])).filter((e) => e.book).map((e) => ({ key: `/works/${e.book.id}`, title: e.title, author_name: [e.book.author], first_publish_year: e.book.year, cover_i: null, number_of_pages_median: e.book.pages, subject: ["Science fiction"] })) })],
  [/openlibrary\.org\/works\/(OL\w+)\/editions\.json/, (m) => { const e = CATALOG.find((c) => c.book?.id === m[1]); return json({ entries: e ? [{ number_of_pages: e.book.pages }] : [] }); }],
  [/openlibrary\.org\/works\/(OL\w+)\.json/, (m) => { const e = CATALOG.find((c) => c.book?.id === m[1]); return e ? json({ title: e.title, description: `${e.title} (sample data).`, subjects: ["Science fiction"], first_publish_date: String(e.book.year), authors: [{ author: { key: "/authors/OL1A" } }] }) : json({}, 404); }],
  [/openlibrary\.org\/authors\/OL1A\.json/, () => json({ name: "Frank Herbert" })],
  [/googleapis\.com\/books\/v1\/volumes\?/, () => json({ items: [] })],
  [/id\.twitch\.tv\/oauth2\/token/, () => json({ access_token: "mock-token", expires_in: 5000000 })],
  [/api\.igdb\.com\/v4\/game_time_to_beats/, async (_m, init) => {
    const id = Number(String(init.body).match(/game_id = (\d+)/)?.[1]);
    const e = CATALOG.find((c) => c.game?.id === id);
    return json(e ? [{ normally: e.game.hours * 3600 }] : []);
  }],
  [/api\.igdb\.com\/v4\/games/, async (_m, init) => {
    const body = String(init.body);
    const toGame = (e) => ({ id: e.game.id, name: e.title, first_release_date: Date.UTC(e.game.year, 5, 1) / 1000, summary: `${e.title} (sample data).`, genres: [{ name: "Adventure" }], platforms: e.game.platforms.map((name) => ({ name })), involved_companies: [{ developer: true, company: { name: e.game.dev } }] });
    const search = body.match(/search "([^"]*)"/);
    if (search) return json(find(search[1]).filter((e) => e.game).map(toGame));
    const id = Number(body.match(/where id = (\d+)/)?.[1]);
    const e = CATALOG.find((c) => c.game?.id === id);
    return json(e ? [toGame(e)] : []);
  }],
];

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  for (const [re, handler] of routes) {
    const m = url.match(re);
    if (m) return handler(m, init ?? {});
  }
  return realFetch(input, init);
};
console.log("[mock-apis] answering TMDB, AniList, Open Library, Google Books, Twitch and IGDB from a built-in catalog");
