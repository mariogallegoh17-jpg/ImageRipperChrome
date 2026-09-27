const MIN_SIZE = 900;

let scanning = false;
let stopRequested = false;

function send(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

function getImageData(img) {
  if (!img) return null;

  const url =
    img.currentSrc ||
    img.src ||
    "";

  if (!url || url.startsWith("data:")) {
    return null;
  }

  const width =
    Number(img.naturalWidth) ||
    Number(img.width) ||
    0;

  const height =
    Number(img.naturalHeight) ||
    Number(img.height) ||
    0;

  let link = "";

  const anchor = img.closest("a");

  if (anchor && anchor.href) {
    link = anchor.href;
  }

  return {
    url,
    width,
    height,
    link
  };
}

function validSize(item) {
  return (
    Number(item.width) >= MIN_SIZE ||
    Number(item.height) >= MIN_SIZE
  );
}

async function startScan() {
  if (scanning) return;

  scanning = true;
  stopRequested = false;

  const images = new Map();

  const originalScroll = window.scrollY;

  function collect() {
    const elements = document.querySelectorAll("img");

    for (const img of elements) {
      const data = getImageData(img);

      if (!data) continue;

      /*
        Usamos URL + enlace como identificador.
        Así evitamos duplicados, pero permitimos que una
        misma imagen aparezca asociada a diferentes enlaces.
      */
      const key =
        `${data.url}|||${data.link}`;

      const existing = images.get(key);

      if (!existing) {
        images.set(key, data);
      } else {
        /*
          Si posteriormente la imagen cargó con una
          resolución mayor, conservamos esa resolución.
        */
        existing.width =
          Math.max(existing.width, data.width);

        existing.height =
          Math.max(existing.height, data.height);

        if (!existing.link && data.link) {
          existing.link = data.link;
        }
      }
    }
  }

  /*
    Observador para detectar imágenes que las páginas
    agregan dinámicamente mientras hacemos scroll.
  */
  const observer = new MutationObserver(() => {
    collect();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "src",
      "srcset",
      "data-src",
      "data-original",
      "data-lazy-src"
    ]
  });

  collect();

  let lastHeight = 0;
  let stableBottom = 0;

  try {
    /*
      Hasta 400 pasos permite páginas extremadamente largas.
    */
    for (let step = 0; step < 400; step++) {

      if (stopRequested) {
        break;
      }

      collect();

      const viewport =
        window.innerHeight || 800;

      /*
        Avance suficientemente grande para que el escaneo
        sea rápido pero permita activar lazy-loading.
      */
      window.scrollBy(
        0,
        Math.max(500, viewport * 0.75)
      );

      /*
        Esperamos a que aparezcan/carguen imágenes.
      */
      await new Promise(resolve =>
        setTimeout(resolve, 700)
      );

      collect();

      await new Promise(resolve =>
        setTimeout(resolve, 300)
      );

      collect();

      const height =
        document.documentElement.scrollHeight;

      const bottom =
        window.innerHeight +
        window.scrollY >=
        height - 30;

      if (bottom) {

        if (height === lastHeight) {
          stableBottom++;
        } else {
          stableBottom = 0;
        }

        lastHeight = height;

        /*
          No terminamos inmediatamente al llegar abajo.
          Esperamos varias rondas porque muchas páginas
          cargan contenido nuevo en el fondo.
        */
        if (stableBottom >= 6) {
          break;
        }
      }

      /*
        Informamos progreso al background.
      */
      const current = Array.from(images.values());

      send({
        action: "scanProgress",
        count: current.length,
        validCount:
          current.filter(validSize).length
      });
    }

    collect();

  } finally {
    observer.disconnect();

    /*
      Dejamos la página donde estaba el usuario.
    */
    window.scrollTo(
      0,
      originalScroll
    );

    scanning = false;
  }

  const allImages =
    Array.from(images.values());

  const groups = [];

  /*
    Creamos grupos.

    Si una imagen tiene un enlace externo, queda asociada
    a ese enlace para que background.js pueda buscar una
    versión de mayor resolución.
  */
  for (const item of allImages) {

    /*
      Ignoramos elementos sin dimensiones reales.
      Los revisaremos indirectamente si tienen enlace.
    */
    if (
      item.width === 0 &&
      item.height === 0 &&
      !item.link
    ) {
      continue;
    }

    groups.push({
      id:
        "grp-" +
        Date.now() +
        "-" +
        Math.random()
          .toString(36)
          .slice(2),

      page: {
        url: item.url,
        width: item.width,
        height: item.height,
        valid: validSize(item)
      },

      link: item.link || "",

      external: [],

      /*
        Si la versión de la página ya cumple 900 px,
        queda seleccionada automáticamente.
      */
      selectedUrl:
        validSize(item)
          ? item.url
          : null
    });
  }

  send({
    action: "scanComplete",
    groups,
    totalDetected: allImages.length,
    validDetected:
      allImages.filter(validSize).length
  });
}

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {

    if (message.action === "startScan") {

      startScan()
        .then(() => {
          sendResponse({
            success: true
          });
        })
        .catch(error => {
          scanning = false;

          sendResponse({
            success: false,
            error: error.message
          });
        });

      return true;
    }

    if (message.action === "stopScan") {
      stopRequested = true;

      sendResponse({
        success: true
      });

      return true;
    }

    if (message.action === "getScanningState") {

      sendResponse({
        scanning
      });

      return true;
    }
  }
);
