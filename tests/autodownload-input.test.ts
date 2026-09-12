import assert from 'node:assert/strict';
import test from 'node:test';
import { canAutoDownloadMessage, youtubeVideoThumbnail } from '../lib/bot-events/autodownload-input';

test('outgoing previews never become download requests, including sibling webhook echoes', () => {
  assert.equal(canAutoDownloadMessage({fromMe:true,messageType:'text'}, false), false);
  assert.equal(canAutoDownloadMessage({fromMe:false,messageType:'text'}, true), false);
  assert.equal(canAutoDownloadMessage({fromMe:false,messageType:'unknown'}, true), false);
  assert.equal(canAutoDownloadMessage({fromMe:false,messageType:'text'}, false), true);
});
test('interactive cards and clicks use their own flow, not automatic URL detection', () => {
  for (const messageType of ['interactive','interactiveMessage','buttons','buttonsMessage','templateMessage','listMessage']) {
    assert.equal(canAutoDownloadMessage({messageType}, false), false);
  }
  assert.equal(canAutoDownloadMessage({buttonResponse:{id:'/ytmp3|https%3A%2F%2Fyoutu.be%2Fe7BMiG54H3M'}}, false), false);
  assert.equal(canAutoDownloadMessage({messageType:'image'}, false), true);
  assert.equal(canAutoDownloadMessage({messageType:'video'}, false), true);
});
test('all supported video URL shapes resolve to the thumbnail of that exact video', () => {
  const id='e7BMiG54H3M';
  for (const url of [`https://youtu.be/${id}?si=abc`,`https://youtube.com/watch?list=PLtest&v=${id}&t=12`,
    `https://www.youtube.com/shorts/${id}`,`https://m.youtube.com/watch?v=${id}`,`https://music.youtube.com/watch?v=${id}`,
    `https://youtube.com/live/${id}`,`https://www.youtube-nocookie.com/embed/${id}`,`youtu.be/${id}`]) {
    assert.equal(youtubeVideoThumbnail(url), `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  }
});
test('unrelated hosts, invalid identifiers and non-video URLs cannot supply a thumbnail', () => {
  for (const url of ['', 'not a url', 'https://youtube.com/playlist?list=abc', 'https://youtube.com/@channel',
    'https://youtu.be/short', 'https://youtu.be/e7BMiG54H3MEXTRA', 'https://youtube.com.evil.test/watch?v=e7BMiG54H3M',
    'https://evil.test/youtu.be/e7BMiG54H3M', 'ftp://youtube.com/watch?v=e7BMiG54H3M']) {
    assert.equal(youtubeVideoThumbnail(url), null);
  }
});
