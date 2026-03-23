window.HANGMAN_CONFIG = {
  // 模式 A（前端直连 GAS）：apiMode = "direct"
  // 模式 B（Netlify Function 代理）：apiMode = "proxy"
  apiMode: "direct",
  gasWebAppUrl: "https://script.google.com/macros/s/AKfycby3bcrdSKBIlBnDsm6FZLaGhX791pNdAHyv84DDOvWQoEDJAR6_rZ9sCA4zGBQjeJTR/exec",
  proxyEndpoint: "/.netlify/functions/sheet-proxy",
  maxWrongGuesses: 6
};
