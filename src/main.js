/**
 * main.js — 启动入口，必须是 manifest 里注入的最后一个文件。
 */
(() => {
  const NS = window.__DSEX__;

  function boot() {
    // 防重复注入：扩展热重载或页面反复导航时都可能再跑一次
    if (document.getElementById(NS.ROOT_ID)) return;
    NS.ui.mount();
  }

  function teardown() {
    document.getElementById(NS.ROOT_ID)?.remove();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  // 扩展被重载后，旧 content script 里的 chrome.* 立刻失效，但定时器还活着。
  // 这里主动退出，免得控制台一直刷 "Extension context invalidated"。
  let stop = null;
  stop = NS.utils.onLocationChange(() => {
    if (!NS.utils.isExtensionAlive()) {
      if (typeof stop === "function") stop();
      teardown();
      return;
    }
    NS.ui.handleLocationChange();
  });
})();
