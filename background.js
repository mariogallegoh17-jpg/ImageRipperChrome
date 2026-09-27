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

function isDirectImageUrl(url) {
if (!url) return false;

try {
const parsed = new URL(url);

const path = parsed.pathname.toLowerCase();

return IMAGE_EXTENSIONS.some(ext =>
  path.endsWith(ext)
);

} catch {
return false;
}
}

async function getImageFromPage(url) {

try {

const response = await fetch(url, {
  credentials: "include"
});

if (!response.ok) {
  return null;
}

const contentType =
  response.headers.get("content-type") || "";

/*
 * Si el servidor ya nos confirma que es una imagen,
 * podemos utilizar directamente esa URL.
 */
if (contentType.startsWith("image/")) {
  return url;
}

/*
 * Si no es HTML, no intentamos tratarlo como una página.
 */
if (!contentType.includes("text/html")) {
  return null;
}

const html = await response.text();

const parser = new DOMParser();
const document = parser.parseFromString(
  html,
  "text/html"
);

const candidates = [];

function addCandidate(candidate, priority = 0) {

  if (!candidate) return;

  try {

    const absolute =
      new URL(candidate, url).href;

    if (
      absolute.startsWith("http://") ||
      absolute.startsWith("https://")
    ) {
      candidates.push({
        url: absolute,
        priority
      });
    }

  } catch {}
}

/*
 * 1. Open Graph.
 * Muchas páginas de imágenes colocan aquí
 * la imagen principal.
 */
document
  .querySelectorAll(
    'meta[property="og:image"], meta[name="twitter:image"]'
  )
  .forEach(meta => {
    addCandidate(
      meta.getAttribute("content"),
      100
    );
  });

/*
 * 2. Imágenes con atributos que suelen indicar
 * una versión grande/original.
 */
document.querySelectorAll("img").forEach(img => {

  const attributes = [
    "data-original",
    "data-full",
    "data-full-image",
    "data-large",
    "data-large-image",
    "data-src",
    "src"
  ];

  for (const attribute of attributes) {

    const value =
      img.getAttribute(attribute);

    if (value) {
      addCandidate(value, 80);
    }
  }

  /*
   * srcset: buscamos la candidata de mayor ancho.
   */
  const srcset =
    img.getAttribute("srcset");

  if (srcset) {

    const entries =
      srcset.split(",");

    let largestWidth = 0;
    let largestUrl = null;

    for (const entry of entries) {

      const parts =
        entry.trim().split(/\s+/);

      const candidateUrl =
        parts[0];

      let width = 0;

      if (
        parts[1] &&
        parts[1].endsWith("w")
      ) {
        width =
          parseInt(parts[1], 10) || 0;
      }

      if (width > largestWidth) {
        largestWidth = width;
        largestUrl = candidateUrl;
      }
    }

    if (largestUrl) {
      addCandidate(
        largestUrl,
        90
      );
    }
  }
});

/*
 * 3. Enlaces que directamente apuntan
 * a archivos de imagen.
 */
document.querySelectorAll("a[href]")
  .forEach(link => {

    const href =
      link.getAttribute("href");

    if (
      href &&
      IMAGE_EXTENSIONS.some(ext =>
        href.toLowerCase().split("?")[0].endsWith(ext)
      )
    ) {
      addCandidate(href, 95);
    }
  });

/*
 * Eliminar duplicados y ordenar por prioridad.
 */
const unique = new Map();

for (const candidate of candidates) {

  const existing =
    unique.get(candidate.url);

  if (
    !existing ||
    candidate.priority > existing.priority
  ) {
    unique.set(
      candidate.url,
      candidate
    );
  }
}

const ordered =
  [...unique.values()]
    .sort((a, b) =>
      b.priority - a.priority
    );

/*
 * Comprobar que la candidata realmente
 * sea una imagen antes de devolverla.
 */
for (const candidate of ordered) {

  if (
    isDirectImageUrl(candidate.url)
  ) {
    return candidate.url;
  }

  try {

    const check =
      await fetch(candidate.url, {
        method: "HEAD",
        credentials: "include"
      });

    const type =
      check.headers.get("content-type") || "";

    if (type.startsWith("image/")) {
      return candidate.url;
    }

  } catch {}
}

return null;

} catch (error) {

console.error(
  "Error analizando página:",
  url,
  error
);

return null;

}
}

async function downloadOriginal(url) {

if (!url) {
return {
success: false,
reason: "URL vacía"
};
}

/*

* Si ya sabemos que es una imagen,
* descargar directamente.
  */
  if (isDirectImageUrl(url)) {

try {

  await chrome.downloads.download({
    url,
    saveAs: false,
    conflictAction: "uniquify"
  });

  return {
    success: true,
    url
  };

} catch (error) {

  return {
    success: false,
    reason: error.message
  };
}

}

/*

* Si parece una página, buscar la imagen.
  */
  const original =
  await getImageFromPage(url);

if (!original) {

return {
  success: false,
  reason: "No se encontró una imagen original"
};

}

try {

await chrome.downloads.download({
  url: original,
  saveAs: false,
  conflictAction: "uniquify"
});

return {
  success: true,
  url: original
};

} catch (error) {

return {
  success: false,
  reason: error.message
};

}
}

chrome.runtime.onMessage.addListener(
(message, sender, sendResponse) => {

if (
  message &&
  message.type === "DOWNLOAD_ORIGINAL"
) {

  downloadOriginal(message.url)
    .then(result => {
      sendResponse(result);
    });

  return true;
}

}
);
