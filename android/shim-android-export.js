/*
 * 青账 · Android 外壳专用补丁
 *
 * 网页里的「导出 CSV 明细 / 导出 JSON 备份」走的是：
 *     URL.createObjectURL(new Blob(...)) -> <a download> -> anchor.click()
 * Android WebView 【不会】处理 blob: 形式的下载，点击会静默无反应。
 *
 * 这段 shim 记住每个 blob URL 对应的 Blob，拦截带 download 属性的 <a> 点击，
 * 把内容读成 base64 交给原生侧（window.Android.saveFile），
 * 由原生用 SAF（ACTION_CREATE_DOCUMENT）弹出「保存到…」，全程不需要存储权限。
 *
 * 只注入到 Android 版资产里；桌面版 index.html 不含这段代码。
 * 如果不在壳环境（没有 window.Android），整段直接不生效。
 */
(function () {
  if (!window.Android || typeof window.Android.saveFile !== 'function') return;

  var blobs = Object.create(null);
  var nativeCreate = URL.createObjectURL;
  var nativeRevoke = URL.revokeObjectURL;
  var nativeClick = HTMLAnchorElement.prototype.click;

  URL.createObjectURL = function (blob) {
    var url = nativeCreate.call(URL, blob);
    try { blobs[url] = blob; } catch (e) { /* 记不住就退回原生行为 */ }
    return url;
  };

  URL.revokeObjectURL = function (url) {
    delete blobs[url];
    try { nativeRevoke.call(URL, url); } catch (e) { }
  };

  HTMLAnchorElement.prototype.click = function () {
    var href = this.getAttribute('href');
    var blob = (this.download && href) ? blobs[href] : null;
    if (!blob) return nativeClick.apply(this, arguments);

    var name = this.download;
    var mime = blob.type || 'application/octet-stream';
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || '');
      var comma = text.indexOf(',');
      window.Android.saveFile(name, mime, comma < 0 ? '' : text.slice(comma + 1));
    };
    reader.onerror = function () {
      window.alert('导出失败：无法读取要保存的内容。');
    };
    reader.readAsDataURL(blob);
  };
})();
