// Feed "Para ti" de X (HomeTimeline), usando la misma API interna que la web de X.
// X cambia seguido el queryId y los "features": por eso se toman de un listado que la comunidad
// mantiene al día (validado) y, si falla, de los valores por defecto de abajo.

export const WEB_BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
export const OPERATIONS_URL =
  'https://raw.githubusercontent.com/fa0311/TwitterInternalAPIDocument/master/docs/json/API.json';
const OPERATIONS_TTL_MS = 24 * 60 * 60 * 1000;

// Valores al 2026-09-27.
export const DEFAULT_OPERATION = Object.freeze({
  queryId: 'og4a4SdSF3WiQkkwaPCdPg',
  features: Object.freeze({
    rweb_video_screen_enabled: false,
    rweb_cashtags_enabled: true,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: true,
    rweb_tipjar_consumption_enabled: false,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    premium_content_api_read_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    responsive_web_grok_analyze_button_fetch_trends_enabled: false,
    responsive_web_grok_analyze_post_followups_enabled: false,
    rweb_cashtags_composer_attachment_enabled: true,
    responsive_web_jetfuel_frame: true,
    rweb_sports_post_context_enabled: true,
    responsive_web_grok_share_attachment_enabled: true,
    responsive_web_grok_annotations_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    content_disclosure_indicator_enabled: true,
    content_disclosure_ai_generated_indicator_enabled: true,
    responsive_web_grok_show_grok_translated_post: true,
    responsive_web_grok_analysis_button_from_backend: true,
    post_ctas_fetch_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: false,
    responsive_web_nested_quote_preview_enabled: false,
    responsive_web_grok_image_annotation_enabled: true,
    responsive_web_grok_imagine_annotation_enabled: true,
    responsive_web_grok_community_note_auto_translation_is_enabled: true,
    responsive_web_enhance_cards_enabled: false,
  }),
});

// Acepta solo datos con la forma esperada: un queryId simple y features booleanos.
export function validateOperation(op) {
  if (!op || typeof op.queryId !== 'string' || !/^[A-Za-z0-9_-]{10,40}$/.test(op.queryId)) return null;
  const features = op.features;
  if (!features || typeof features !== 'object') return null;
  const entries = Object.entries(features);
  if (entries.length === 0 || entries.length > 200) return null;
  if (!entries.every(([k, v]) => /^[a-z0-9_]{1,100}$/.test(k) && typeof v === 'boolean')) return null;
  return { queryId: op.queryId, features: Object.fromEntries(entries) };
}

// Devuelve una función que obtiene la operación actual (cacheada 24 h, con respaldo).
export function createOperationProvider({ fetchImpl = fetch, now = Date.now, logger = console } = {}) {
  let cached = null;
  let cachedAt = 0;
  return async function getOperation() {
    if (cached && now() - cachedAt < OPERATIONS_TTL_MS) return cached;
    try {
      const res = await fetchImpl(OPERATIONS_URL, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`listado respondió ${res.status}`);
      const data = await res.json();
      cached = validateOperation(data?.graphql?.HomeTimeline) ?? DEFAULT_OPERATION;
    } catch (err) {
      logger.warn?.(`No se pudo actualizar la operación HomeTimeline: ${err.message}`);
      cached = cached ?? DEFAULT_OPERATION;
    }
    cachedAt = now();
    return cached;
  };
}

export function buildHomeTimelineUrl(op, { cursor, count = 20 } = {}) {
  const variables = {
    count,
    includePromotedContent: true,
    latestControlAvailable: true,
    requestContext: 'launch',
    withCommunity: true,
    ...(cursor ? { cursor } : {}),
  };
  const params = new URLSearchParams({ variables: JSON.stringify(variables), features: JSON.stringify(op.features) });
  return `https://x.com/i/api/graphql/${op.queryId}/HomeTimeline?${params}`;
}

// ---------- Lectura de la respuesta ----------

function unwrap(result) {
  if (!result) return null;
  if (result.__typename === 'TweetWithVisibilityResults') return result.tweet ?? null;
  return result.__typename === 'Tweet' || result.rest_id ? result : null;
}

function userOf(tweet) {
  const u = tweet?.core?.user_results?.result;
  return {
    name: u?.core?.name ?? u?.legacy?.name ?? '',
    username: u?.core?.screen_name ?? u?.legacy?.screen_name ?? '',
  };
}

function decodeEntities(text) {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function textOf(tweet) {
  const legacy = tweet.legacy ?? {};
  let text = tweet.note_tweet?.note_tweet_results?.result?.text ?? legacy.full_text ?? '';
  // Quita el link t.co que X agrega al final para las fotos/videos (la foto se envía aparte).
  for (const m of legacy.extended_entities?.media ?? legacy.entities?.media ?? []) {
    if (m.url) text = text.replace(m.url, '');
  }
  // Reemplaza los links acortados t.co por los reales.
  for (const u of legacy.entities?.urls ?? []) {
    if (u.url && u.expanded_url) text = text.replace(u.url, u.expanded_url);
  }
  return decodeEntities(text).trim();
}

function photosOf(tweet) {
  return (tweet.legacy?.extended_entities?.media ?? [])
    .filter((m) => m.type === 'photo' && m.media_url_https)
    .map((m) => m.media_url_https);
}

// Convierte un tweet de la API en { id, ids, author, text, url, photos, retweetedBy, replyTo, promoted }.
export function toTweet(rawResult, { promoted = false } = {}) {
  const outer = unwrap(rawResult);
  if (!outer?.rest_id) return null;
  const retweeted = unwrap(outer.legacy?.retweeted_status_result?.result);
  const tweet = retweeted ?? outer;
  const author = userOf(tweet);
  return {
    id: outer.rest_id,
    // Se marcan como vistos el retweet y el original, así no se repite ninguno de los dos.
    ids: [...new Set([outer.rest_id, tweet.rest_id])],
    author,
    text: textOf(tweet),
    url: `https://x.com/${author.username || 'i'}/status/${tweet.rest_id}`,
    photos: photosOf(tweet),
    retweetedBy: retweeted ? userOf(outer).username : null,
    replyTo: tweet.legacy?.in_reply_to_screen_name ?? null,
    promoted,
  };
}

function itemsOf(entry) {
  const content = entry.content ?? {};
  if (content.itemContent) return [content.itemContent];
  return (content.items ?? []).map((i) => i.item?.itemContent).filter(Boolean);
}

// Lee una página del feed: { tweets, cursor } (cursor = siguiente página o null).
export function parseTimeline(json) {
  const instructions = json?.data?.home?.home_timeline_urt?.instructions ?? [];
  const tweets = [];
  let cursor = null;
  for (const instruction of instructions) {
    for (const entry of instruction.entries ?? (instruction.entry ? [instruction.entry] : [])) {
      const content = entry.content ?? {};
      if (content.cursorType === 'Bottom') cursor = content.value ?? cursor;
      for (const item of itemsOf(entry)) {
        if (item.itemType !== 'TimelineTweet') continue;
        const promoted = Boolean(item.promotedMetadata) || /^promoted/i.test(entry.entryId ?? '');
        const tweet = toTweet(item.tweet_results?.result, { promoted });
        if (tweet) tweets.push(tweet);
      }
    }
  }
  return { tweets, cursor };
}
