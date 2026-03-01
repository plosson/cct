module.exports = {
  appId: "com.cct.app",
  productName: "CCT",
  directories: {
    output: "dist"
  },
  files: [
    "main.js",
    "index.html",
    "styles/**/*",
    "src/main/**/*",
    "dist/renderer.bundle.js",
    "dist/renderer.bundle.js.map",
    "node_modules/@xterm/xterm/css/**",
    "package.json"
  ],
  mac: {
    target: ["dmg", "zip"],
    category: "public.app-category.developer-tools",
    darkModeSupport: true
  },
  dmg: {
    background: null,
    window: { width: 540, height: 380 }
  },
  publish: {
    provider: "github",
    owner: "plosson",
    repo: "cct"
  }
};
