const IMAGE_EXTENSIONS = [
".jpg",
".jpeg",
".png",
".webp",
".gif",
".bmp",
".avif",
".tif",
".tiff"
];

function isImageFile(url) {
if (!url) return false;

try {
const pathname =
new URL(url).pathname.toLowerCase();

return IMAGE_EXTENSIONS.some(ext =>
  pathname.endsWith(ext)
);

} catch {
return false;
}
}

function normalizeUrl(url, baseUrl) {
if (!url) return null;

try {
const result = new URL(url, baseUrl).href;

if (
  result.startsWith("http://") ||
  result.startsWith("https://")
) {
  return result;
}

return null;

} catch {
return null;
}
}

function uniqueVersions(list) {
const map = new Map();

for (const item of list) {
if (!item || !item.url) continue;

const existing = map.get(item.url);

if (!existing) {
  map.set(item.url, item);
  continue;
}

if (
  (item.width || 0) * (item.height || 0) >
  (existing.width || 0) * (existing.height || 0)
) {
  map.set(item.url, item);
}

}

return [...map.values()];
}

function collectImagesFromDocument(document, baseUrl) {
const results = [];

function add(url, source, width = 0, height = 0) {
const absolute = normalizeUrl(url, baseUrl);

if (!absolute) return;

results.push({
  url: absolute,
  source,
  width: Number(width) || 0,
  height: Number(height) || 0
});

}

/*

* META / Open Graph
  */
  document.querySelectorAll(
  'meta[property="og:image"], meta[name="twitter:image"]'
  ).forEach(meta => {
  add(
  meta.getAttribute("content"),
  "Página de destino"
  );
  });

/*

* IMG
  */
  document.querySelectorAll("img").forEach(img => {

const width =
  img.naturalWidth ||
  parseInt(img.getAttribute("width")) ||
  0;

const height =
  img.naturalHeight ||
  parseInt(img.getAttribute("height")) ||
  0;

/*
 * currentSrc / src
 */
if (img.currentSrc) {
  add(
    img.currentSrc,
    "Página de destino",
    width,
    height
  );
}

if (img.src) {
  add(
    img.src,
    "Página de destino",
    width,
    height
  );
}

/*
 * Atributos habituales de imágenes grandes.
 */
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

for (const attribute of attributes) {
  const value = img.getAttribute(attribute);

  if (value) {
    add(
      value,
      "Imagen original indicada por la página",
      width,
      height
    );
  }
}

/*
 * SRCSET
 */
const srcset =
  img.getAttribute("srcset");

if (srcset) {

  for (const entry of srcset.split(",")) {

    const parts =
      entry.trim().split(/\s+/);

    const url = parts[0];

    let candidateWidth = 0;

    if (
      parts[1] &&
      parts[1].endsWith("w")
    ) {
      candidateWidth =
        parseInt(parts[1], 10) || 0;
    }

    add(
      url,
      "srcset",
      candidateWidth,
      0
    );
  }
}

});

/*

* Enlaces que apuntan directamente a imágenes.
  */
  document.querySelectorAll("a[href]").forEach(a => {

const href =
  a.getAttribute("href");

if (!href) return;

const absolute =
  normalizeUrl(href, baseUrl);

if (!absolute) return;

if (isImageFile(absolute)) {

  add(
    absolute,
    "Enlace directo",
    0,
    0
  );
}

});

return uniqueVersions(results);
}

/*

* Analiza una pestaña después de que su contenido
* haya terminado de cargar.
  */
  async function inspectTab(tabId, baseUrl) {

try {

const result =
  await chrome.scripting.executeScript({
    target: {
      tabId
    },
    func: () => {

      function collect() {

        const images = [];

        function add(
          url,
          source,
          width = 0,
          height = 0
        ) {
          if (!url) return;

          images.push({
            url,
            source,
            width:
              Number(width) || 0,
            height:
              Number(height) || 0
          });
        }

        document.querySelectorAll(
          'meta[property="og:image"], meta[name="twitter:image"]'
        ).forEach(meta => {

          add(
            meta.content,
            "Página de destino"
          );
        });

        document.querySelectorAll("img")
          .forEach(img => {

            const width =
              img.naturalWidth ||
              img.width ||
              0;

            const height =
              img.naturalHeight ||
              img.height ||
              0;

            if (img.currentSrc) {
              add(
                img.currentSrc,
                "Página de destino",
                width,
                height
              );
            }

            if (img.src) {
              add(
                img.src,
                "Página de destino",
                width,
                height
              );
            }

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
                add(
                  value,
                  "Imagen original indicada por la página",
                  width,
                  height
                );
              }
            }

            const srcset =
              img.getAttribute("srcset");

            if (srcset) {

              for (
                const entry
                of srcset.split(",")
              ) {

                const parts =
                  entry.trim()
                    .split(/\s+/);

                let candidateWidth = 0;

                if (
                  parts[1] &&
                  parts[1].endsWith("w")
                ) {
                  candidateWidth =
                    parseInt(
                      parts[1],
                      10
                    ) || 0;
                }

                add(
                  parts[0],
                  "srcset",
                  candidateWidth,
                  0
                );
              }
            }
          });

        document.querySelectorAll(
          "a[href]"
        ).forEach(a => {

          const href =
            a.href;

          if (!href) return;

          const path =
            new URL(href).pathname
              .toLowerCase();

          const extensions = [
            ".jpg",
            ".jpeg",
            ".png",
            ".webp",
            ".gif",
            ".bmp",
            ".avif",
            ".tif",
            ".tiff"
          ];

          if (
            extensions.some(ext =>
              path.endsWith(ext)
            )
          ) {
            add(
              href,
              "Enlace directo"
            );
          }
        });

        return images;
      }

      return collect();
    }
  });

return result?.[0]?.result || [];

} catch (error) {

console.error(
  "No se pudo analizar la pestaña:",
  error
);

return [];

}
}

/*

* Abre el enlace en una pestaña temporal,
* espera su carga y analiza las imágenes.
  */
  async function inspectDestination(url) {

let tab = null;

try {

tab =
  await chrome.tabs.create({
    url,
    active: false
  });

/*
 * Esperamos hasta que la página termine
 * de cargar.
 */
await waitForTabLoad(tab.id);

/*
 * Esperamos un poco más para que imágenes
 * dinámicas tengan oportunidad de aparecer.
 */
await delay(1200);

const images =
  await inspectTab(
    tab.id,
    url
  );

return images;

} catch (error) {

console.error(
  "Error inspeccionando destino:",
  error
);

return [];

} finally {

if (tab?.id) {

  try {
    await chrome.tabs.remove(tab.id);
  } catch {}
}

}
}

function waitForTabLoad(tabId) {

return new Promise(resolve => {

let finished = false;

function done() {

  if (finished) return;

  finished = true;

  chrome.tabs.onUpdated.removeListener(
    listener
  );

  resolve();
}

function listener(
  updatedTabId,
  changeInfo
) {

  if (
    updatedTabId === tabId &&
    changeInfo.status === "complete"
  ) {
    done();
  }
}

chrome.tabs.onUpdated.addListener(
  listener
);

setTimeout(
  done,
  15000
);

});
}

function delay(ms) {
return new Promise(resolve =>
setTimeout(resolve, ms)
);
}

/*

* Recibe una lista de imágenes detectadas
* en la página principal y busca versiones
* adicionales en sus enlaces.
  */
  async function findVersions(images) {

const finalResults = [];

for (let i = 0; i < images.length; i++) {

const image =
  images[i];

const versions = [];

/*
 * Mantener SIEMPRE la imagen original
 * encontrada en la página.
 */
versions.push({
  url: image.url,
  source: "Página actual",
  width: image.width || 0,
  height: image.height || 0
});

/*
 * Si tiene un enlace asociado y es diferente
 * a la propia imagen, analizarlo.
 */
if (
  image.link &&
  image.link !== image.url
) {

  const destinationImages =
    await inspectDestination(
      image.link
    );

  for (
    const destination
    of destinationImages
  ) {

    versions.push({
      url: destination.url,
      source:
        destination.source ||
        "Enlace asociado",
      width:
        destination.width || 0,
      height:
        destination.height || 0
    });
  }
}

finalResults.push({
  index: i,
  versions: uniqueVersions(versions)
});

}

return finalResults;
}

chrome.runtime.onMessage.addListener(
(message, sender, sendResponse) => {

if (
  message?.type ===
  "FIND_VERSIONS"
) {

  findVersions(
    message.images || []
  )
  .then(result => {
    sendResponse({
      success: true,
      results: result
    });
  })
  .catch(error => {

    console.error(error);

    sendResponse({
      success: false,
      error: error.message
    });
  });

  return true;
}

if (
  message?.type ===
  "DOWNLOAD_SELECTED"
) {

  downloadSelected(
    message.items || []
  )
  .then(result => {
    sendResponse(result);
  });

  return true;
}

}
);

async function downloadSelected(items) {

let downloaded = 0;
let failed = 0;

for (const item of items) {

try {

  await chrome.downloads.download({
    url: item.url,
    saveAs: false,
    conflictAction: "uniquify"
  });

  downloaded++;

  await delay(150);

} catch (error) {

  console.error(
    "Error descargando:",
    item.url,
    error
  );

  failed++;
}

}

return {
success: true,
downloaded,
failed
};
}
