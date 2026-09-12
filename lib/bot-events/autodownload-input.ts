type DownloadInput = {
  fromMe?: boolean;
  messageType?: string | null;
  buttonResponse?: unknown;
};

/** A bot's outgoing preview is not a new download request, even when a
 * sibling connection delivers it with fromMe=false. Button clicks follow
 * the explicit command path, never automatic link detection. */
export function canAutoDownloadMessage(message: DownloadInput, isFromInstance: boolean): boolean {
  if (isFromInstance || message.fromMe || message.buttonResponse) return false;
  const type = String(message.messageType ?? "").replace(/[^a-z]/gi, "").toLowerCase();
  return !new Set([
    "interactive", "interactivemessage", "buttons", "buttonsmessage",
    "template", "templatemessage", "list", "listmessage",
  ]).has(type);
}

/** Use the video's real thumbnail, never a generic or unrelated banner. */
export function youtubeVideoThumbnail(value: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    let id: string | null = null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (host === 'youtu.be') id = parts[0] ?? null;
    else if (['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'].includes(host)) {
      id = url.pathname === '/watch' ? url.searchParams.get('v')
        : ['shorts', 'embed', 'live', 'v'].includes(parts[0]) ? parts[1] ?? null : null;
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
  } catch {
    return null;
  }
}
