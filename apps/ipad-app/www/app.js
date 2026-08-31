/**
 * Placeholder runtime probe: report whether the page runs inside the
 * Capacitor native WebView or a plain browser (cap serve / vite preview).
 */
const runtime = document.getElementById('runtime')

const capacitor = globalThis.Capacitor
runtime.textContent = capacitor?.isNativePlatform?.() === true
  ? '运行时：原生 WebView（iOS）'
  : '运行时：浏览器（非原生）'