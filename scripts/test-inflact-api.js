#!/usr/bin/env node

const { fetchInflactProfile } = require("../helper/inflact-viewer");

const username = process.argv[2] || "douglasreis.dev";
const force = process.argv.includes("--refresh");

fetchInflactProfile(username, { forceRefresh: force })
  .then((data) => {
    console.log(JSON.stringify(data, null, 2));
  })
  .catch((error) => {
    if (error.response) {
      console.error("Failed with status", error.response.status);
      console.error(
        typeof error.response.data === "string"
          ? error.response.data
          : JSON.stringify(error.response.data, null, 2),
      );
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  });
