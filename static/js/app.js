document.addEventListener("DOMContentLoaded", function () {
  var fileInput = document.querySelector("[data-file-input]");
  var fileList = document.querySelector("[data-file-list]");

  function formatBytes(size) {
    if (!size) return "";
    if (size < 1024 * 1024) return Math.max(1, Math.round(size / 1024)) + " KB";
    return (size / (1024 * 1024)).toFixed(1) + " MB";
  }

  function createPreviewElement(type, source, name) {
    var element = document.createElement(type === "video" ? "video" : "img");
    element.src = source;
    element.className = "file-preview-media";
    if (type === "video") {
      element.muted = true;
      element.preload = "metadata";
      element.playsInline = true;
    } else {
      element.alt = name || "";
    }
    return element;
  }

  function createFileListItem(name, size, type, previewUrl) {
    var item = document.createElement("li");
    item.className = previewUrl ? "file-list-item has-preview" : "file-list-item";

    if (previewUrl && (type === "image" || type === "video")) {
      var thumb = document.createElement("span");
      thumb.className = "file-preview-thumb";
      thumb.appendChild(createPreviewElement(type, previewUrl, name));
      item.appendChild(thumb);
    }

    var meta = document.createElement("span");
    meta.className = "file-preview-meta";
    var title = document.createElement("strong");
    title.textContent = name;
    meta.appendChild(title);
    var detail = document.createElement("small");
    detail.textContent = formatBytes(size);
    meta.appendChild(detail);
    item.appendChild(meta);
    return item;
  }

  if (fileInput && fileList) {
    var localPreviewUrls = [];

    function clearLocalPreviewUrls() {
      localPreviewUrls.forEach(function (url) {
        URL.revokeObjectURL(url);
      });
      localPreviewUrls = [];
    }

    fileInput.addEventListener("change", function () {
      fileList.innerHTML = "";
      clearLocalPreviewUrls();
      Array.from(fileInput.files || []).forEach(function (file) {
        var type = file.type && file.type.indexOf("video/") === 0 ? "video" : "image";
        var previewUrl = "";
        if (file.type && (file.type.indexOf("image/") === 0 || file.type.indexOf("video/") === 0)) {
          previewUrl = URL.createObjectURL(file);
          localPreviewUrls.push(previewUrl);
        }
        fileList.appendChild(createFileListItem(file.name, file.size, type, previewUrl));
      });
    });

    window.addEventListener("beforeunload", clearLocalPreviewUrls);
  }

  var mobileUpload = document.querySelector("[data-mobile-upload]");
  if (mobileUpload) {
    var statusUrl = mobileUpload.dataset.statusUrl;
    var mobileList = mobileUpload.querySelector("[data-mobile-upload-list]");
    var lastMobileStatus = "";

    function renderMobileUploads(payload) {
      if (!mobileList) return;
      var signature = JSON.stringify(payload);
      if (signature === lastMobileStatus) return;
      lastMobileStatus = signature;
      mobileList.innerHTML = "";

      if (!payload.items || !payload.items.length) {
        var empty = document.createElement("li");
        empty.textContent = "还没有从手机上传的文件";
        empty.dataset.empty = "true";
        mobileList.appendChild(empty);
      } else {
        payload.items.forEach(function (upload) {
          mobileList.appendChild(createFileListItem(upload.name, upload.size, upload.type, upload.preview_url));
        });
      }

      if (!payload.active) {
        var status = document.createElement("li");
        status.textContent = payload.expired ? "二维码已过期" : "二维码已完成";
        status.className = "muted-status";
        mobileList.appendChild(status);
      }
    }

    function pollMobileUploads() {
      if (!statusUrl) return;
      fetch(statusUrl, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      })
        .then(function (response) {
          if (!response.ok) throw new Error("status failed");
          return response.json();
        })
        .then(renderMobileUploads)
        .catch(function () {});
    }

    pollMobileUploads();
    window.setInterval(pollMobileUploads, 5000);
  }

  var backdrop = document.querySelector("[data-preview]");
  if (!backdrop) return;

  var dialog = backdrop.querySelector("[data-preview-dialog]");
  var caption = backdrop.querySelector("[data-preview-caption]");
  var close = backdrop.querySelector("[data-preview-close]");

  function closePreview() {
    backdrop.classList.remove("open");
    dialog.innerHTML = "";
    caption.textContent = "";
  }

  document.querySelectorAll("[data-media-url]").forEach(function (button) {
    button.addEventListener("click", function () {
      var url = button.dataset.mediaUrl;
      var type = button.dataset.mediaType;
      var name = button.dataset.mediaName || "";
      var element = document.createElement(type === "video" ? "video" : "img");
      element.src = url;
      if (type === "video") {
        element.controls = true;
        element.autoplay = true;
      } else {
        element.alt = name;
      }
      dialog.innerHTML = "";
      dialog.appendChild(element);
      caption.textContent = name;
      backdrop.classList.add("open");
    });
  });

  close.addEventListener("click", closePreview);
  backdrop.addEventListener("click", function (event) {
    if (event.target === backdrop) closePreview();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closePreview();
  });
});
