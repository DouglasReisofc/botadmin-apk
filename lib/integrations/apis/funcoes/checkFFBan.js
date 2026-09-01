const axios = require('axios');

async function checkFFBan(uid) {
  try {
    const { data } = await axios.get(
      `https://ff.garena.com/api/antihack/check_banned?lang=pt&uid=${uid}`,
      {
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          'Referer': 'https://ff.garena.com/pt/support/',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
          'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
          'X-Requested-With': 'B6FksShzIgjfrYImLpTsadjS86sddhFH'
        }
      }
    );
    return data;
  } catch (error) {
    throw error;
  }
}

module.exports = checkFFBan;
