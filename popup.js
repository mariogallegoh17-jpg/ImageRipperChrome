let detectedImages = [];

const scanButton =
document.getElementById("scan");

const downloadAllButton =
document.getElementById("downloadAll");

const info =
document.getElementById("info");

const imagesContainer =
document.getElementById("images");

scanButton.addEventListener(
"click",
scanPage
);

downloadAllButton.addEventListener(
"click",
downloadAll
);

async function getActiveTab() {

const tabs =
await chrome.tabs.query({
active: true,
currentWindow: true
});

return tabs[0];
}

async function scanPage() {

info.textContent =
"Buscando imágenes y enlaces originales...";

imagesContainer.innerHTML = "";

try {

const tab =
  await getActiveTab();

const results =
  await chrome.scripting.executeScript({
    target: {
      tabId: tab.id
    },
    func: extractImages
  });

detectedImages =
  results[0].result || [];

renderImages();

} catch (error) {

console.error(error);

info.textContent =
  "No se pudo analizar esta página.";

}
}

function extractImages() {

const results = [];
const seen = new Set();

function absoluteUrl(url) {

if (!url) return null;

try {
  return new URL(
    url,
    location.href
  ).href;
} catch {
  return null;
}

}

function addImage(
thumbnail,
target,
width,
height
) {

thumbnail =
  absoluteUrl(thumbnail);

target =
  absoluteUrl(target);

if (!target) return;

if (
  !target.startsWith("http://") &&
  !target.startsWith("https://")
) {
  return;
}

if (seen.has(target)) return;

seen.add(target);

results.push({

  thumbnail:
    thumbnail || target,

  target,

  width:
    Number(width) || 0,

  height:
    Number(height) || 0
});

}

document
.querySelectorAll("img")
.forEach(img => {

  const thumbnail =
    img.currentSrc ||
    img.src ||
    img.getAttribute("data-src");

  let target = null;

  /*
   * Si la imagen está dentro de un enlace,
   * ese enlace es nuestro candidato principal.
   */
  const link =
    img.closest("a[href]");

  if (
    link &&
    link.href
  ) {
    target =
      link.href;
  }

  /*
   * Atributos utilizados frecuentemente
   * para almacenar imágenes grandes.
   */
  if (!target) {

    const attributes = [

      "data-original",
      "data-original-src",
      "data-full",
      "data-full-image",
      "data-large",
      "data-large-image",
      "data-image",
      "data-src"
    ];

    for (
      const attribute
      of attributes
    ) {

      const value =
        img.getAttribute(attribute);

      if (value) {

        target = value;

        break;
      }
    }
  }

  /*
   * Si existe srcset buscamos la versión
   * con mayor ancho.
   */
  if (
    !target &&
    img.srcset
  ) {

    let largestWidth = 0;
    let largestUrl = null;

    const candidates =
      img.srcset
        .split(",")
        .map(
          item => item.trim()
        );

    for (
      const candidate
      of candidates
    ) {

      const parts =
        candidate.split(/\s+/);

      const url =
        parts[0];

      let width = 0;

      if (
        parts[1] &&
        parts[1].endsWith("w")
      ) {

        width =
          parseInt(
            parts[1],
            10
          ) || 0;
      }

      if (
        width >
        largestWidth
      ) {

        largestWidth =
          width;

        largestUrl =
          url;
      }
    }

    if (largestUrl) {
      target =
        largestUrl;
    }
  }

  /*
   * Como último recurso usamos la propia imagen.
   */
  if (!target) {
    target = thumbnail;
  }

  addImage(
    thumbnail,
    target,
    img.naturalWidth ||
      img.width,

    img.naturalHeight ||
      img.height
  );
});

return results;
}

function renderImages() {

imagesContainer.innerHTML = "";

if (!detectedImages.length) {

info.textContent =
  "No se encontraron imágenes.";

imagesContainer.innerHTML =
  '<div class="empty">No se han detectado imágenes.</div>';

return;

}

info.textContent =
"Encontradas: ${detectedImages.length} imágenes";

detectedImages.forEach(
(image, index) => {

  const item =
    document.createElement("div");

  item.className =
    "image-item";

  const checkbox =
    document.createElement("input");

  checkbox.type =
    "checkbox";

  checkbox.checked =
    true;

  checkbox.dataset.index =
    index;

  const preview =
    document.createElement("img");

  preview.src =
    image.thumbnail;

  const details =
    document.createElement("div");

  details.className =
    "details";

  const size =
    document.createElement("div");

  size.className =
    "size";

  if (
    image.width &&
    image.height
  ) {

    size.textContent =
      `${image.width} × ${image.height}`;

  } else {

    size.textContent =
      "Resolución desconocida";
  }

  const url =
    document.createElement("div");

  url.className =
    "url";

  url.textContent =
    image.target;

  details.appendChild(size);
  details.appendChild(url);

  item.appendChild(checkbox);
  item.appendChild(preview);
  item.appendChild(details);

  imagesContainer.appendChild(item);
}

);
}

async function downloadAll() {

if (!detectedImages.length) {

info.textContent =
  "Primero debes escanear la página.";

return;

}

const selected =
[
...document.querySelectorAll(
'input[type="checkbox"]:checked'
)
];

if (!selected.length) {

info.textContent =
  "No hay imágenes seleccionadas.";

return;

}

let completed = 0;
let failed = 0;

for (
const checkbox
of selected
) {

const index =
  Number(
    checkbox.dataset.index
  );

const image =
  detectedImages[index];

info.textContent =
  `Procesando ${completed + failed + 1} de ${selected.length}...`;

try {

  const result =
    await chrome.runtime.sendMessage({
      type:
        "DOWNLOAD_ORIGINAL",

      url:
        image.target
    });

  if (
    result &&
    result.success
  ) {

    completed++;

  } else {

    failed++;
  }

} catch (error) {

  console.error(error);

  failed++;
}

}

info.textContent =
"Terminadas: ${completed}. No encontradas: ${failed}.";
}
