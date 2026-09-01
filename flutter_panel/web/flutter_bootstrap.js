{{flutter_js}}
{{flutter_build_config}}

// BotAdmin: CanvasKit local (Skia/WebGL), sem CDN gstatic.
_flutter.loader.load({
  config: {
    renderer: "canvaskit",
    canvasKitBaseUrl: "canvaskit/",
  },
  serviceWorkerSettings: null,
  onEntrypointLoaded: function (engineInitializer) {
    return engineInitializer
      .initializeEngine({
        renderer: "canvaskit",
        canvasKitBaseUrl: "canvaskit/",
      })
      .then(function (appRunner) {
        return appRunner.runApp();
      });
  },
});
