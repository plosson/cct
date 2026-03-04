module.exports = {
  appId: "com.claudiu.app",
  productName: "Claudiu",
  directories: {
    output: "dist",
    buildResources: "build"
  },
  extraResources: [
    { from: "themes/default", to: "themes/default" }
  ],
  files: [
    "main.js",
    "index.html",
    "styles/**/*",
    "fonts/**/*",
    "src/main/**/*",
    "dist/renderer.bundle.js",
    "dist/renderer.bundle.js.map",
    "node_modules/@xterm/xterm/css/**",
    "assets/**/*",
    "package.json"
  ],
  mac: {
    target: ["dmg", "zip"],
    category: "public.app-category.developer-tools",
    darkModeSupport: true,
    icon: "build/icon.icns"
  },
  dmg: {
    background: null,
    window: { width: 540, height: 380 }
  },
  publish: {
    provider: "github",
    owner: "plosson",
    repo: "cct",
    releaseType: "release"
  }
};
