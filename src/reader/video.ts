// Videos (docs/read-and-listen/architecture.md, "Videos"): a YouTube video's subtitles read as a text
// while the video plays above them (ReadWatch.tsx). Which line is playing, looping one, what an error
// from the player means, and the page the player runs in. Pure, so it's tested; nothing here grades a
// card. The server reads a link the same way (server/reader video.py `video_id`).

/** The speeds Watch offers: normal, and slower for following along. */
export const VIDEO_RATES = [1, 0.75] as const;
export type VideoRate = (typeof VIDEO_RATES)[number];

/** A looped line starts again once the video is this far past its end, so its last word isn't cut. */
const LOOP_GRACE_MS = 250;

const ID = '([A-Za-z0-9_-]{11})';
const LINKS = [
  new RegExp(`^(?:https?://)?(?:www\\.|m\\.|music\\.)?youtube\\.com/watch\\?(?:[^#]*&)?v=${ID}`),
  new RegExp(`^(?:https?://)?(?:www\\.|m\\.)?youtube\\.com/(?:shorts|embed|live|v)/${ID}`),
  new RegExp(`^(?:https?://)?youtu\\.be/${ID}`),
  new RegExp(`^${ID}$`),
];

/** The video's id from a link someone shared or pasted, or null when it isn't a YouTube video's. */
export function videoIdOf(link: string): string | null {
  const text = link.trim();
  for (const pattern of LINKS) {
    const found = pattern.exec(text);
    if (found) return found[1];
  }
  return null;
}

/**
 * The line playing at `ms`: the one whose time holds it, or between two lines the one before, so the
 * highlight stays on what was just said. -1 before the first line.
 */
export function lineAt(times: readonly (readonly [number, number])[], ms: number): number {
  let found = -1;
  for (let i = 0; i < times.length; i++) {
    if (times[i][0] <= ms) found = i;
    else break;
  }
  return found;
}

/** Where to go back to, in seconds, when the looped `line` has played past its end; null while it hasn't. */
export function loopBack(times: readonly (readonly [number, number])[], line: number, ms: number): number | null {
  const t = times[line];
  if (!t) return null;
  return ms >= t[1] + LOOP_GRACE_MS || ms < t[0] - LOOP_GRACE_MS ? t[0] / 1000 : null;
}

/** "8:42" for a length in seconds. */
export function videoLength(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** What a YouTube player error means, for the screen to say. */
export function playerErrorText(code: number): string {
  if (code === 101 || code === 150) return "The video's owner doesn't let it play outside YouTube. Open it in YouTube to watch it, and read along here.";
  if (code === 100) return 'YouTube says this video has been removed or made private.';
  if (code === 153) return "YouTube's player wouldn't load here. Open the video in YouTube to watch it, and read along here.";
  return "The video couldn't play. Try again, or open it in YouTube.";
}

/** The video's page on YouTube, to open it there. */
export const youtubeLink = (id: string): string => `https://www.youtube.com/watch?v=${id}`;

/** Where the player's page says it is: the privacy-enhanced embed's own site, so its subtitles aren't shown and it keeps fewer cookies. */
export const PLAYER_ORIGIN = 'https://www.youtube-nocookie.com';

/**
 * The page Watch's player runs in: YouTube's IFrame player for `id`, inline and without its own
 * subtitles, posting its time about five times a second, its state and any error, and taking `seek`,
 * `rate`, `play` and `pause` from the screen (`window.franki`). `id` is checked to be an id first.
 */
export function playerHtml(id: string): string {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error(`Not a YouTube video id: ${id}`);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>html,body{margin:0;height:100%;background:#000}#p{position:absolute;top:0;left:0;width:100%;height:100%}</style></head>
<body><div id="p"></div><script src="https://www.youtube.com/iframe_api"></script><script>
var player=null,last=-1;
function post(m){window.ReactNativeWebView.postMessage(JSON.stringify(m));}
function onYouTubeIframeAPIReady(){
  player=new YT.Player('p',{width:'100%',height:'100%',videoId:${JSON.stringify(id)},host:'${PLAYER_ORIGIN}',
    playerVars:{playsinline:1,rel:0,modestbranding:1,cc_load_policy:0,iv_load_policy:3,origin:'${PLAYER_ORIGIN}'},
    events:{onReady:function(){post({type:'ready'});},onStateChange:function(e){post({type:'state',state:e.data});},onError:function(e){post({type:'error',code:e.data});}}});
  setInterval(function(){if(!player||!player.getCurrentTime)return;var ms=Math.round(player.getCurrentTime()*1000);if(ms!==last){last=ms;post({type:'time',ms:ms});}},200);
}
window.franki={seek:function(s){if(player)player.seekTo(s,true);},rate:function(r){if(player)player.setPlaybackRate(r);},play:function(){if(player)player.playVideo();},pause:function(){if(player)player.pauseVideo();}};
</script></body></html>`;
}

/** A message from the player's page, read leniently: anything else is null. */
export type PlayerMessage = { type: 'ready' } | { type: 'time'; ms: number } | { type: 'state'; state: number } | { type: 'error'; code: number };

export function parsePlayerMessage(data: string): PlayerMessage | null {
  try {
    const m = JSON.parse(data) as Record<string, unknown>;
    if (m.type === 'ready') return { type: 'ready' };
    if (m.type === 'time' && typeof m.ms === 'number') return { type: 'time', ms: m.ms };
    if (m.type === 'state' && typeof m.state === 'number') return { type: 'state', state: m.state };
    if (m.type === 'error' && typeof m.code === 'number') return { type: 'error', code: m.code };
  } catch {
    // not one of the page's messages
  }
  return null;
}

/** YouTube's player state for playing (YT.PlayerState.PLAYING). */
export const PLAYING = 1;
