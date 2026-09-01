const notSupported = () => {
  throw new Error("sharp is not supported in this Termux/Android environment.");
};

const makeChain = () =>
  new Proxy(function () {}, {
    apply() {
      return makeChain();
    },
    get(_target, prop) {
      if (prop === "toBuffer" || prop === "toFile" || prop === "metadata") {
        return async () => notSupported();
      }
      if (prop === "then") {
        return undefined;
      }
      return () => makeChain();
    },
  });

const sharp = () => makeChain();
sharp.cache = () => {};
sharp.concurrency = () => {};
sharp.simd = () => {};
sharp.format = {};
sharp.versions = {};

module.exports = sharp;
module.exports.default = sharp;
