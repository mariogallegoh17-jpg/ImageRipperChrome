let detectedImages = [];

const scanButton = document.getElementById("scan");
const downloadAllButton = document.getElementById("downloadAll");
const info = document.getElementById("info");
const imagesContainer = document.getElementById("images");

scanButton.addEventListener("click", scanPage);
downloadAllButton.addEventListener("click", downloadAll);

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs[0];
}

async function scanPage() {
  info.textContent = "Escaneando página...";
  imagesContainer.innerHTML = "";

  try {
    const tab = await getActiveTab();

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractImages
    });

    detectedImages = results[0].result || [];

    renderImages();

  } catch (error) {
    console.error(error);
    info.textContent =
      "No se pudo analizar esta página. Algunas páginas especiales de Chrome no permiten extensiones.";
  }
}

function extractImages() {
  const results = [];
  const seen = new Set();

  function addImage(url, width, height) {
    if (!url) return;

    try {
      url = new URL(url, location.href).href;
    } catch {
      return;
    }

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return;
    }

    if (seen.has(url)) return;

    seen.add(url);

    results.push({
      url,
      width: Number(width) || 0,
      height: Number(height) || 0,
      area: (Number(width) || 0) * (Number(height) || 0)
    });
  }

  document.querySelectorAll("img").forEach(img => {

    let bestUrl = img.currentSrc || img.src;

    let bestWidth = img.naturalWidth || img.width || 0;
    let bestHeight = img.naturalHeight || img.height || 0;

    if (img.srcset) {
      const candidates = img.srcset
        .split(",")
        .map(item => item.trim())
        .map(item => {
          const parts = item.split(/\s+/);

          return {
            url: parts[0],
            descriptor: parts[1] || ""
          };
        });

      for (const candidate of candidates) {
        let width = 0;

        if (candidate.descriptor.endsWith("w")) {
          width = parseInt(candidate.descriptor);
        }

        if (width > bestWidth) {
          bestWidth = width;
          bestUrl = candidate.url;
        }
      }
    }

    addImage(bestUrl, bestWidth, bestHeight);
  });

  document.querySelectorAll("picture source").forEach(source => {

    if (!source.srcset) return;

    const candidates = source.srcset
      .split(",")
      .map(item => item.trim());

    for (const candidate of candidates) {
      const parts = candidate.split(/\s+/);
      const url = parts[0];

      let width = 0;

      if (parts[1] && parts[1].endsWith("w")) {
        width = parseInt(parts[1]);
      }

      addImage(url, width, 0);
    }
  });

  return results
    .sort((a, b) => b.area - a.area);
}

function renderImages() {

  imagesContainer.innerHTML = "";

  if (!detectedImages.length) {
    info.textContent = "No se encontraron imágenes.";
    imagesContainer.innerHTML =
      '<div class="empty">No se han detectado imágenes.</div>';
    return;
  }

  info.textContent =
    `Encontradas: ${detectedImages.length} imágenes`;

  detectedImages.forEach((image, index) => {

    const item = document.createElement("div");
    item.className = "image-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.dataset.index = index;

    const preview = document.createElement("img");
    preview.src = image.url;

    const details = document.createElement("div");
    details.className = "details";

    const size = document.createElement("div");
    size.className = "size";

    if (image.width && image.height) {
      size.textContent =
        `${image.width} × ${image.height}`;
    } else {
      size.textContent = "Resolución desconocida";
    }

    const url = document.createElement("div");
    url.className = "url";
    url.textContent = image.url;

    details.appendChild(size);
    details.appendChild(url);

    item.appendChild(checkbox);
    item.appendChild(preview);
    item.appendChild(details);

    imagesContainer.appendChild(item);
  });
}

async function downloadAll() {

  if (!detectedImages.length) {
    info.textContent = "Primero debes escanear la página.";
    return;
  }

  const checkboxes =
    document.querySelectorAll('input[type="checkbox"]:checked');

  if (!checkboxes.length) {
    info.textContent = "No hay imágenes seleccionadas.";
    return;
  }

  info.textContent =
    `Descargando ${checkboxes.length} imágenes...`;

  for (const checkbox of checkboxes) {

    const index = Number(checkbox.dataset.index);
    const image = detectedImages[index];

    try {

      await chrome.downloads.download({
        url: image.url,
        saveAs: false
      });

      await delay(150);

    } catch (error) {
      console.error("Error descargando:", image.url, error);
    }
  }

  info.textContent =
    `Proceso terminado: ${checkboxes.length} imágenes procesadas.`;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
