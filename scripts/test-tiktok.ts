import { GET as TikTokGET } from "../app/api/rest/tiktok/route";

async function run(url: string) {
  const req = new Request(`http://localhost:4478/api/rest/tiktok?url=${encodeURIComponent(url)}`);
  const res = await TikTokGET(req as any);
  const status = (res as Response).status;
  const text = await (res as Response).text();
  console.log("Status:", status);
  console.log("Body:", text);
}

const url = process.argv[2] || "https://www.tiktok.com/t/zp8auh7yp";
run(url).catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});

