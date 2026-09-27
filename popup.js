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
info.textContent = "Buscando imágenes y enlaces originales...";
imagesContainer.innerHTML = "";

try {
const tab = await getActiveTab();

const results = await chrome.scripting.executeScript({
  target: { tabId: tab.id },
  func: extractImageLinks
});

detectedImages = results[0].result || [];

renderImages();

} catch (error) {
console.error(error);
info.textContent =
"No se pudo analizar esta página.";
}
}

function extractImageLinks() {
const results = [];
const seen = new Set();

function absoluteUrl(url) {
if (!url) return null;

try {
  return new URL(url, location.href).href;
} catch {
  return null;
}

}

function addResult(thumbnail, original, width, height) {
thumbnail = absoluteUrl(thumbnail);
original = absoluteUrl(original);

if (!original) return;

if (!original.startsWith("http://") &&
    !original.startsWith("https://")) {
  return;
}

if (seen.has(original)) return;

seen.add(original);

results.push({
  thumbnail: thumbnail || original,
  original,
  width: Number(width) || 0,
  height: Number(height) || 0,
  area: (Number(width) || 0) * (Number(height) || 0)
});

}

document.querySelectorAll("img").forEach(img => {

const thumbnail =
  img.currentSrc ||
  img.src ||
  img.getAttribute("data-src");

let original = null;

/*
 * PRIMERA OPCIÓN:
 * buscar un enlace que envuelva la miniatura.
 */
const link = img.closest("a");

if (link && link.href) {
  original = link.href;
}

/*
 * SEGUNDA OPCIÓN:
 * atributos comunes utilizados por galerías.
 */
if (!original) {
  const possibleAttributes = [
    "data-full",
    "data-full-image",
    "data-original",
    "data-original-src",
    "data-large",
    "data-large-image",
    "data-image",
    "data-src"
  ];

  for (const attribute of possibleAttributes) {
    const value = img.getAttribute(attribute);

    if (value) {
      original = value;
      break;
    }
  }
}

/*
 * TERCERA OPCIÓN:
 * usar srcset y elegir la candidata más grande.
 */
if (!original && img.srcset) {

  let largestWidth = 0;
  let largestUrl = null;

  const candidates = img.srcset
    .split(",")
    .map(item => item.trim());

  for (const candidate of candidates) {

    const parts = candidate.split(/\s+/);
    const url = parts[0];

    let width = 0;

    if (parts[1] && parts[1].endsWith("w")) {
      width = parseInt(parts[1]);
    }

    if (width > largestWidth) {
      largestWidth = width;
      largestUrl = url;
    }
  }

  if (largestUrl) {
    original = largestUrl;
  }
}

/*
 * CUARTA OPCIÓN:
 * si no encontramos un enlace especial,
 * usamos la imagen actual.
 */
if (!original) {
  original = thumbnail;
}

addResult(
  thumbnail,
  original,
  img.naturalWidth || img.width,
  img.naturalHeight || img.height
);

});

return results;
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
"Encontradas: ${detectedImages.length} imágenes";

detectedImages.forEach((image, index) => {

const item = document.createElement("div");
item.className = "image-item";

const checkbox = document.createElement("input");

checkbox.type = "checkbox";
checkbox.checked = true;
checkbox.dataset.index = index;

const preview = document.createElement("img");
preview.src = image.thumbnail;

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

url.textContent = image.original;

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
info.textContent =
"Primero debes escanear la página.";

return;

}

const checkboxes =
document.querySelectorAll(
'input[type="checkbox"]:checked'
);

if (!checkboxes.length) {
info.textContent =
"No hay imágenes seleccionadas.";

return;

}

info.textContent =
"Descargando ${checkboxes.length} originales...";

let completed = 0;

for (const checkbox of checkboxes) {

const index =
  Number(checkbox.dataset.index);

const image =
  detectedImages[index];

try {

  await chrome.downloads.download({
    url: image.original,
    saveAs: false,
    conflictAction: "uniquify"
  });

  completed++;

  info.textContent =
    `Descargando ${completed} de ${checkboxes.length}...`;

  await delay(150);

} catch (error) {

  console.error(
    "Error descargando:",
    image.original,
    error
  );
}

}

info.textContent =
"Terminadas: ${completed} de ${checkboxes.length}";
}

function delay(ms) {
return new Promise(resolve => setTimeout(resolve, ms));
}
