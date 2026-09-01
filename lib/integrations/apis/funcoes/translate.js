const fetch = require('node-fetch');

async function tr(query = '', lang = 'pt') {
  if (!query.trim()) return ['', '??'];
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.append('client', 'gtx');
  url.searchParams.append('sl', 'auto');
  url.searchParams.append('dt', 't');
  url.searchParams.append('tl', lang);
  url.searchParams.append('q', query);

  const response = await fetch(url.href);
  const data = await response.json();
  if (data) {
    return [data[0].map((item) => item[0].trim()).join('\n'), data[2]];
  }
  return ['', '??'];
}

module.exports = tr;
