// Respuestas simuladas de la API de X para los tests (misma forma que HomeTimeline).

export function user(username, name = username.toUpperCase()) {
  return { user_results: { result: { __typename: 'User', core: { screen_name: username, name } } } };
}

export function rawTweet(id, { username = 'autor', text = `tweet ${id}`, extra = {}, legacy = {} } = {}) {
  return { __typename: 'Tweet', rest_id: id, core: user(username), legacy: { full_text: text, ...legacy }, ...extra };
}

export function entry(result, { entryId, promoted = false } = {}) {
  return {
    entryId: entryId ?? `tweet-${result.rest_id ?? result.tweet?.rest_id}`,
    content: {
      entryType: 'TimelineTimelineItem',
      itemContent: {
        itemType: 'TimelineTweet',
        tweet_results: { result },
        ...(promoted ? { promotedMetadata: { advertiser_results: {} } } : {}),
      },
    },
  };
}

export function cursorEntry(value) {
  return { entryId: `cursor-bottom-${value}`, content: { entryType: 'TimelineTimelineCursor', cursorType: 'Bottom', value } };
}

export function timeline(entries) {
  return { data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries }] } } } };
}
