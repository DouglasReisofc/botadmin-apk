#!/usr/bin/env node
const { fetchInflactDownloadPost } = require('../helper/inflact-viewer');

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/test-inflact-download.js <instagram-url>');
  process.exit(1);
}

fetchInflactDownloadPost(target)
  .then((data) => {
    const post = data?.data?.post;
    console.log(JSON.stringify({
      status: data?.status,
      video_url: post?.video_url,
      shortcode: post?.shortcode,
      owner: post?.owner?.username,
    }, null, 2));
  })
  .catch((error) => {
    if (error?.response) {
      console.error(error.response.status, error.response.data);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  });
