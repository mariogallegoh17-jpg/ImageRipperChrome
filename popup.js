let detectedImages = [];
let versions = [];

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
downloadSelected
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
"Analizando imágenes...";

imagesContainer.innerHTML = "";

try {

const tab =
  await getActiveTab();

const result =
  await chrome.scripting.executeScript({
    target: {
      tabId: tab.id
    },
    func: () => {

      const images = [];

      document.querySelectorAll("img")
        .forEach(img => {

          const thumbnail =
            img.currentSrc ||
            img.src;

          if (!thumbnail) return;

          const link =
            img.closest("a[href]");

          images.push({

            url:
              thumbnail,

            link:
              link ?
              link.href :
              null,

            width:
              img.naturalWidth ||
              img.width ||
              0,

            height:
              img.naturalHeight ||
              img.height ||
              0
          });
        });

      return images;
    }
  });

detectedImages =
  result?.[0]?.result || [];

if (!detectedImages.length) {

  info.textContent =
    "No se encontraron imágenes.";

  return;
}

info.textContent =
  `Encontradas ${detectedImages.length}. Buscando versiones...`;

const response =
  await chrome.runtime.sendMessage({
    type:
      "FIND_VERSIONS",

    images:
      detectedImages
  });

if (
  !response ||
  !response.success
) {

  info.textContent =
    "No se pudieron buscar las versiones.";

  return;
}

versions =
  response.results || [];

renderVersions();

} catch (error) {

console.error(error);

info.textContent =
  "Error durante el análisis.";

}
}

function formatSize(width, height) {

if (
width &&
height
) {

return `${width} × ${height}`;

}

return "Resolución no determinada";
}

function renderVersions() {

imagesContainer.innerHTML = "";

let totalVersions = 0;

versions.forEach(
(group, groupIndex) => {

  const box =
    document.createElement("div");

  box.style.marginBottom =
    "18px";

  box.style.padding =
    "10px";

  box.style.background =
    "#191919";

  box.style.border =
    "1px solid #333";

  box.style.borderRadius =
    "8px";

  const title =
    document.createElement("div");

  title.textContent =
    `IMAGEN ${groupIndex + 1}`;

  title.style.fontWeight =
    "bold";

  title.style.marginBottom =
    "8px";

  box.appendChild(title);

  group.versions.forEach(
    (version, versionIndex) => {

      totalVersions++;

      const row =
        document.createElement("label");

      row.style.display =
        "flex";

      row.style.alignItems =
        "center";

      row.style.gap =
        "8px";

      row.style.padding =
        "8px 4px";

      row.style.borderTop =
        "1px solid #292929";

      const checkbox =
        document.createElement("input");

      checkbox.type =
        "checkbox";

      checkbox.dataset.group =
        groupIndex;

      checkbox.dataset.version =
        versionIndex;

      /*
       * Por defecto seleccionamos únicamente
       * la versión que aparece en la página.
       */
      checkbox.checked =
        version.source ===
        "Página actual";

      const text =
        document.createElement("div");

      text.style.flex =
        "1";

      const resolution =
        document.createElement("strong");

      resolution.textContent =
        formatSize(
          version.width,
          version.height
        );

      const source =
        document.createElement("div");

      source.textContent =
        version.source;

      source.style.fontSize =
        "11px";

      source.style.color =
        "#999";

      source.style.marginTop =
        "3px";

      text.appendChild(
        resolution
      );

      text.appendChild(
        source
      );

      row.appendChild(
        checkbox
      );

      row.appendChild(
        text
      );

      box.appendChild(
        row
      );
    }
  );

  imagesContainer.appendChild(
    box
  );
}

);

info.textContent =
"${versions.length} imágenes · ${totalVersions} versiones encontradas";
}

async function downloadSelected() {

const selected =
[
...imagesContainer.querySelectorAll(
'input[type="checkbox"]:checked'
)
];

if (!selected.length) {

info.textContent =
  "Selecciona al menos una versión.";

return;

}

const items = [];

for (const checkbox of selected) {

const groupIndex =
  Number(
    checkbox.dataset.group
  );

const versionIndex =
  Number(
    checkbox.dataset.version
  );

const version =
  versions[
    groupIndex
  ]?.versions[
    versionIndex
  ];

if (version) {
  items.push(version);
}

}

info.textContent =
"Descargando ${items.length} imágenes...";

try {

const response =
  await chrome.runtime.sendMessage({
    type:
      "DOWNLOAD_SELECTED",

    items
  });

if (
  response &&
  response.success
) {

  info.textContent =
    `Descargadas: ${response.downloaded}. Fallidas: ${response.failed}.`;

} else {

  info.textContent =
    "No se pudieron completar las descargas.";
}

} catch (error) {

console.error(error);

info.textContent =
  "Error durante la descarga.";

}
}
