document.addEventListener("DOMContentLoaded", function () {
  var fileInput = document.querySelector("[data-file-input]");
  var fileList = document.querySelector("[data-file-list]");
  if (fileInput && fileList) {
    fileInput.addEventListener("change", function () {
      fileList.innerHTML = "";
      Array.from(fileInput.files || []).forEach(function (file) {
        var item = document.createElement("li");
        item.textContent = file.name;
        fileList.appendChild(item);
      });
    });
  }

  var mobileUpload = document.querySelector("[data-mobile-upload]");
  if (mobileUpload) {
    var statusUrl = mobileUpload.dataset.statusUrl;
    var mobileList = mobileUpload.querySelector("[data-mobile-upload-list]");
    var lastMobileStatus = "";

    function formatBytes(size) {
      if (!size) return "";
      if (size < 1024 * 1024) return Math.round(size / 1024) + " KB";
      return (size / (1024 * 1024)).toFixed(1) + " MB";
    }

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
          var item = document.createElement("li");
          var size = formatBytes(upload.size);
          item.textContent = size ? upload.name + " · " + size : upload.name;
          mobileList.appendChild(item);
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
