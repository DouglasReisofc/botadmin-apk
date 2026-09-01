type NativeAppOpenScriptProps = {
  next?: string;
};

const buildScript = (next: string) => `
(function () {
  try {
    var ua = navigator.userAgent || "";
    if (!/Android/i.test(ua)) return;
    var url = new URL(window.location.href);
    if (url.searchParams.get("web") === "1" || url.searchParams.get("noapp") === "1") return;
    if (url.hostname !== "botadmin.shop" && url.hostname !== "www.botadmin.shop") return;
    var key = "ba-public-native-open:" + url.pathname + url.search;
    var now = Date.now();
    var last = Number(sessionStorage.getItem(key) || "0");
    if (last && now - last < 30000) return;
    sessionStorage.setItem(key, String(now));
    var fallback = new URL(window.location.href);
    fallback.searchParams.set("web", "1");
    var configuredNext = ${JSON.stringify(next)};
    var currentNext = url.pathname + url.search + url.hash;
    var targetNext = configuredNext && configuredNext !== "/dashboard/user" ? configuredNext : currentNext;
    var intent = "intent://" + url.host + url.pathname + url.search + url.hash + "#Intent;scheme=https;package=com.botadmin.shop;S.browser_fallback_url=" + encodeURIComponent(fallback.href) + ";S.botadmin_next=" + encodeURIComponent(targetNext || "/dashboard/user") + ";end";
    setTimeout(function () {
      window.location.href = intent;
    }, 420);
  } catch (e) {}
})();`;

export default function NativeAppOpenScript({
  next = "/dashboard/user",
}: NativeAppOpenScriptProps) {
  return (
    <script
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: buildScript(next) }}
    />
  );
}
