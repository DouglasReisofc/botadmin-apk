const Canvas = (() => {
  const candidates = ['@napi-rs/canvas', 'canvas'];
  let lastError = null;
  for (const name of candidates) {
    try {
      const mod = require(name);
      if (mod) return mod;
    } catch (error) {
      lastError = error;
    }
  }
  const error = new Error("Canvas dependency not found. Install '@napi-rs/canvas' or 'canvas'.");
  if (lastError) error.cause = lastError;
  throw error;
})();

Canvas.registerFont(`${__dirname}/src/fonts/LemonMilk.otf`, { family: "Bold" });
Canvas.registerFont(`${__dirname}/src/fonts/JosefinSans-Regular.ttf`, { family: "Normal" });
Canvas.registerFont(__dirname + '/src/fonts/normal.ttf', {
  family: 'Manrope',
  weight: 'regular',
  style: 'normal'
});
Canvas.registerFont(__dirname + '/src/fonts/bold.ttf', {
  family: 'Manrope',
  weight: 'bold',
  style: 'normal'
});


module.exports = {
  CanvasSenpai: require("./src/canva.js")
}
