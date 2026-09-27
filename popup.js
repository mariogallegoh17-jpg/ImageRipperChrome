const MIN_SIZE = 900;

const scanButton = document.getElementById("scan");
const downloadButton = document.getElementById("download");
const stopButton = document.getElementById("stop");

const resultsContainer = document.getElementById("results");
const statusText = document.getElementById("status");
const progressText = document.getElementById("progress");

let groups = [];
let scanning = false;
let scanStopped = false;


// =====================================================
// COMPROBAR DIMENSIONES
// =====================================================

function validSize(width, height) {
  return width >= MIN_SIZE || height >= MIN_SIZE;
}


// =====================================================
// FORMATO DE DIMENSIONES
// =====================================================

function formatSize(width, height) {

  if (width && height) {
    return `${width} × ${height}`;
  }

  return "Dimensiones no detectadas";
}


// =====================================================
// SEGURIDAD HTML
// =====================================================

function escapeHtml(text) {

  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


// =====================================================
// OBTENER IMÁGENES ACTUALES
// =====================================================

async function getCurrentImages() {

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  const result = await chrome.scripting.executeScript({

    target: {
      tabId: tab.id
    },

    func: () => {

      const images = [];

      document.querySelectorAll("img").forEach((img, index) => {

        const width =
          img.naturalWidth ||
          img.width ||
          0;

        const height =
          img.naturalHeight ||
          img.height ||
          0;

        let link = "";

        const anchor = img.closest("a");

        if (anchor) {
          link = anchor.href || "";
        }

        images.push({

          index,

          url:
            img.currentSrc ||
            img.src ||
            "",

          width,

          height,

          link
        });
      });

      return images;
    }
  });

  return result?.[0]?.result || [];
}


// =====================================================
// HACER SCROLL PROGRESIVO
// =====================================================

async function scrollPageCompletely() {

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return await chrome.scripting.executeScript({

    target: {
      tabId: tab.id
    },

    func: async () => {

      const originalPosition = window.scrollY;

      let lastHeight = 0;
      let stableRounds = 0;

      const maxRounds = 300;

      for (let round = 0; round < maxRounds; round++) {

        // Bajar una pantalla
        window.scrollBy(
          0,
          Math.max(
            600,
            window.innerHeight * 0.85
          )
        );

        // Esperar carga de imágenes / contenido
        await new Promise(resolve =>
          setTimeout(resolve, 700)
        );

        // Esperar un poco más si la página
        // está agregando contenido dinámicamente
        await new Promise(resolve =>
          setTimeout(resolve, 200)
        );

        const currentHeight =
          document.documentElement.scrollHeight;

        const currentPosition =
          window.scrollY + window.innerHeight;

        if (
          currentHeight === lastHeight &&
          currentPosition >= currentHeight - 10
        ) {

          stableRounds++;

        } else {

          stableRounds = 0;
        }

        lastHeight = currentHeight;

        // Si llevamos varias comprobaciones
        // sin contenido nuevo, consideramos
        // que llegamos al final.
        if (stableRounds >= 4) {
          break;
        }

        // Si ya estamos al final
        if (
          window.scrollY + window.innerHeight
          >= document.documentElement.scrollHeight - 5
        ) {

          // Dar oportunidad a lazy loading
          await new Promise(resolve =>
            setTimeout(resolve, 1200)
          );

          const finalHeight =
            document.documentElement.scrollHeight;

          if (finalHeight === currentHeight) {
            break;
          }
        }
      }

      // Volver al lugar donde estaba el usuario
      window.scrollTo({
        top: originalPosition,
        behavior: "instant"
      });

      return true;
    }
  });
}


// =====================================================
// INSPECCIONAR ENLACE EXTERNO
// =====================================================

async function inspectExternalLink(url) {

  return new Promise(resolve => {

    chrome.runtime.sendMessage(
      {
        action: "inspectDestination",
        url
      },
      response => {

        if (!response || !response.success) {
          resolve([]);
          return;
        }

        resolve(response.versions || []);
      }
    );
  });
}


// =====================================================
// AGREGAR / ACTUALIZAR IMÁGENES
// =====================================================

function buildGroups(images) {

  const map = new Map();

  for (const image of images) {

    if (!image.url) continue;

    /*
     * La URL se utiliza para evitar
     * duplicados.
     */
    const key = image.url.split("#")[0];

    if (map.has(key)) {

      const existing = map.get(key);

      /*
       * Si posteriormente conseguimos
       * mejores dimensiones, actualizarlas.
       */
      if (
        image.width > existing.width ||
        image.height > existing.height
      ) {

        existing.width = image.width;
        existing.height = image.height;
      }

      if (!existing.link && image.link) {
        existing.link = image.link;
      }

      continue;
    }

    map.set(key, {
      url: image.url,
      width: image.width || 0,
      height: image.height || 0,
      link: image.link || ""
    });
  }

  return [...map.values()];
}


// =====================================================
// ESCANEO PRINCIPAL
// =====================================================

async function scan() {

  if (scanning) return;

  scanning = true;
  scanStopped = false;

  scanButton.disabled = true;
  downloadButton.disabled = true;
  stopButton.style.display = "block";

  groups = [];

  resultsContainer.innerHTML = "";

  statusText.textContent =
    "Preparando escaneo completo...";

  progressText.textContent =
    "0 imágenes detectadas";


  try {

    // -----------------------------------------------
    // PRIMERA CAPTURA
    // -----------------------------------------------

    let allImages = await getCurrentImages();

    let uniqueImages =
      buildGroups(allImages);

    progressText.textContent =
      `${uniqueImages.length} imágenes detectadas`;


    // -----------------------------------------------
    // RECORRER TODA LA PÁGINA
    // -----------------------------------------------

    statusText.textContent =
      "Recorriendo toda la página...";

    await scrollPageCompletely();


    if (scanStopped) {
      finishScan();
      return;
    }


    // -----------------------------------------------
    // CAPTURA FINAL
    // -----------------------------------------------

    allImages = await getCurrentImages();

    uniqueImages =
      buildGroups(allImages);


    progressText.textContent =
      `${uniqueImages.length} imágenes encontradas`;


    // -----------------------------------------------
    // FILTRAR POR 900 PX
    // -----------------------------------------------

    const validImages =
      uniqueImages.filter(image =>
        validSize(
          image.width,
          image.height
        )
      );


    statusText.textContent =
      `Procesando ${validImages.length} imágenes válidas...`;


    // -----------------------------------------------
    // CREAR GRUPOS
    // -----------------------------------------------

    groups = [];

    let number = 0;

    for (const image of validImages) {

      if (scanStopped) break;

      const versions = [];

      // Imagen que está en la página
      versions.push({

        url: image.url,

        width: image.width,

        height: image.height,

        source: "Página actual",

        checked: true
      });


      /*
       * Si tiene enlace asociado, buscar
       * versiones adicionales.
       */
      if (image.link) {

        try {

          const externalVersions =
            await inspectExternalLink(
              image.link
            );


          externalVersions.forEach(version => {

            if (!version.url) return;


            /*
             * Solo mostrar versiones
             * que realmente cumplen >=900
             *
             * Si no conocemos las dimensiones,
             * no la incluimos todavía.
             */

            if (
              validSize(
                version.width,
                version.height
              )
            ) {

              versions.push({

                ...version,

                checked: false
              });
            }
          });

        } catch (error) {

          console.error(
            "Error procesando enlace:",
            error
          );
        }
      }


      // -------------------------------------------
      // ELIMINAR DUPLICADOS
      // -------------------------------------------

      const uniqueVersions = [];

      const seen = new Set();

      versions.forEach(version => {

        const key =
          version.url?.split("#")[0];

        if (!key || seen.has(key)) return;

        seen.add(key);

        uniqueVersions.push(version);
      });


      if (!uniqueVersions.length) continue;


      number++;


      groups.push({

        number,

        versions: uniqueVersions
      });


      // Actualizar progreso
      progressText.textContent =
        `${number} imágenes válidas procesadas`;

      renderResults();
    }


    finishScan();


  } catch (error) {

    console.error(error);

    statusText.textContent =
      "Ocurrió un error durante el escaneo.";

  } finally {

    scanning = false;

    scanButton.disabled = false;

    downloadButton.disabled = false;

    stopButton.style.display = "none";
  }
}


// =====================================================
// FINALIZAR ESCANEO
// =====================================================

function finishScan() {

  scanning = false;

  scanButton.disabled = false;

  downloadButton.disabled = false;

  stopButton.style.display = "none";

  renderResults();

  updateSelectedCounter();

  statusText.textContent =
    "Escaneo terminado.";
}


// =====================================================
// DETENER
// =====================================================

function stopScan() {

  scanStopped = true;

  statusText.textContent =
    "Deteniendo escaneo...";

  stopButton.style.display = "none";
}


// =====================================================
// RENDERIZAR RESULTADOS
// =====================================================

function renderResults() {

  resultsContainer.innerHTML = "";

  groups.forEach(group => {

    const groupElement =
      document.createElement("div");

    groupElement.className =
      "image-group";


    let html = `
      <div class="image-title">
        IMAGEN ${group.number}
      </div>
    `;


    group.versions.forEach(
      (version, index) => {

        const size =
          formatSize(
            version.width,
            version.height
          );


        html += `
          <label class="version">

            <input
              type="checkbox"
              data-group="${group.number}"
              data-version="${index}"
              ${version.checked ? "checked" : ""}
            >

            <span>

              <strong>
                ${escapeHtml(size)}
              </strong>

              <br>

              <small>
                ${escapeHtml(
                  version.source ||
                  "Versión encontrada"
                )}
              </small>

            </span>

          </label>
        `;
      }
    );


    groupElement.innerHTML = html;

    resultsContainer.appendChild(
      groupElement
    );
  });


  // Eventos de selección

  resultsContainer
    .querySelectorAll(
      'input[type="checkbox"]'
    )
    .forEach(checkbox => {

      checkbox.addEventListener(
        "change",
        updateSelectedCounter
      );
    });
}


// =====================================================
// CONTADOR
// =====================================================

function getSelectedCount() {

  return resultsContainer.querySelectorAll(
    'input[type="checkbox"]:checked'
  ).length;
}


function updateSelectedCounter() {

  const selected =
    getSelectedCount();

  const total =
    groups.length;


  if (!total) {

    progressText.textContent =
      "0 imágenes seleccionadas";

    return;
  }


  progressText.textContent =
    `${total} imágenes encontradas · ${selected} seleccionadas`;
}


// =====================================================
// DESCARGAR
// =====================================================

async function downloadSelected() {

  const checkboxes =
    resultsContainer.querySelectorAll(
      'input[type="checkbox"]:checked'
    );


  if (!checkboxes.length) {

    statusText.textContent =
      "No seleccionaste ninguna imagen.";

    return;
  }


  downloadButton.disabled = true;


  let count = 0;


  for (const checkbox of checkboxes) {

    const groupNumber =
      Number(
        checkbox.dataset.group
      );


    const versionIndex =
      Number(
        checkbox.dataset.version
      );


    const group =
      groups.find(
        g => g.number === groupNumber
      );


    if (!group) continue;


    const version =
      group.versions[versionIndex];


    if (!version?.url) continue;


    try {

      await chrome.downloads.download({

        url: version.url,

        saveAs: false
      });


      count++;


      statusText.textContent =
        `Descargando ${count} de ${checkboxes.length}...`;


    } catch (error) {

      console.error(
        "Error descargando:",
        version.url,
        error
      );
    }
  }


  downloadButton.disabled = false;


  statusText.textContent =
    `${count} descarga(s) iniciada(s).`;
}


// =====================================================
// EVENTOS
// =====================================================

scanButton.addEventListener(
  "click",
  scan
);


downloadButton.addEventListener(
  "click",
  downloadSelected
);


stopButton.addEventListener(
  "click",
  stopScan
);
