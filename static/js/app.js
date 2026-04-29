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
