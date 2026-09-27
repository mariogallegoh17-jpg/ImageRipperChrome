const MIN_SIZE = 900;

const scanButton = document.getElementById("scan");
const downloadButton = document.getElementById("download");
const stopButton = document.getElementById("stop");

const resultsContainer = document.getElementById("results");
const statusText = document.getElementById("status");
const progressText = document.getElementById("progress");

let groups = [];
let scanning = false;
let stopRequested = false;


// =====================================================
// TAMAÑO MÍNIMO
// =====================================================

function validSize(width, height) {
  return width >= MIN_SIZE || height >= MIN_SIZE;
}


// =====================================================
// FORMATO
// =====================================================

function formatSize(width, height) {

  if (width && height) {
    return `${width} × ${height}`;
  }

  return "Dimensiones no detectadas";
}


// =====================================================
// SEGURIDAD
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
// ESCANEAR TODA LA PÁGINA
//
// IMPORTANTE:
// El escaneo y el scroll ocurren dentro de la página.
// En cada paso se capturan las imágenes nuevas.
// =====================================================

async function scanWholePage() {

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab || !tab.id) {
    throw new Error("No se encontró la pestaña.");
  }


  const result = await chrome.scripting.executeScript({

    target: {
      tabId: tab.id
    },

    func: async () => {

      const MIN = 900;

      const imageMap = new Map();

      const originalPosition = window.scrollY;


      function addImages() {

        document.querySelectorAll("img").forEach(img => {

          const url =
            img.currentSrc ||
            img.src ||
            "";

          if (!url) return;


          const width =
            img.naturalWidth ||
            img.width ||
            0;


          const height =
            img.naturalHeight ||
            img.height ||
            0;


          let link = "";

          const anchor =
            img.closest("a");

          if (anchor) {
            link = anchor.href || "";
          }


          /*
           * Usamos URL + enlace como identificación.
           * Así evitamos duplicar la misma imagen.
           */

          const key =
            url.split("#")[0] +
            "|" +
            link;


          const old =
            imageMap.get(key);


          if (!old) {

            imageMap.set(key, {

              url,

              width,

              height,

              link
            });

          } else {

            /*
             * Si posteriormente la imagen
             * obtiene dimensiones reales,
             * actualizamos.
             */

            if (width > old.width) {
              old.width = width;
            }

            if (height > old.height) {
              old.height = height;
            }

            if (!old.link && link) {
              old.link = link;
            }
          }
        });
      }


      /*
       * Primera captura.
       */

      addImages();


      let previousHeight =
        document.documentElement.scrollHeight;

      let bottomStable = 0;

      const MAX_ROUNDS = 250;


      for (
        let round = 0;
        round < MAX_ROUNDS;
        round++
      ) {

        /*
         * Capturar antes de bajar.
         */

        addImages();


        /*
         * Bajar aproximadamente una pantalla.
         */

        window.scrollBy({

          top:
            Math.max(
              500,
              window.innerHeight * 0.85
            ),

          behavior: "instant"
        });


        /*
         * Esperar lazy loading.
         */

        await new Promise(resolve =>
          setTimeout(resolve, 450)
        );


        /*
         * Capturar inmediatamente las nuevas.
         */

        addImages();


        const currentHeight =
          document.documentElement.scrollHeight;


        const atBottom =
          window.scrollY +
          window.innerHeight >=
          currentHeight - 10;


        if (
          atBottom &&
          currentHeight === previousHeight
        ) {

          bottomStable++;

        } else {

          bottomStable = 0;
        }


        previousHeight =
          currentHeight;


        /*
         * Si llegamos al final y durante varias
         * comprobaciones no aparece contenido nuevo,
         * terminamos.
         */

        if (bottomStable >= 4) {
          break;
        }
      }


      /*
       * Última captura.
       */

      addImages();


      /*
       * Volver a la posición original.
       */

      window.scrollTo({

        top: originalPosition,

        behavior: "instant"
      });


      /*
       * Convertir Map a Array.
       */

      const all =
        [...imageMap.values()];


      /*
       * Filtrar aquí mismo por 900 px o más.
       */

      const valid =
        all.filter(image =>
          image.width >= MIN ||
          image.height >= MIN
        );


      return {

        totalDetected: all.length,

        validImages: valid
      };
    }
  });


  return result?.[0]?.result || {
    totalDetected: 0,
    validImages: []
  };
}


// =====================================================
// PROCESAR UNA IMAGEN
// =====================================================

async function processImage(image, number) {

  const versions = [];


  /*
   * La imagen que encontramos directamente
   * en la página ya cumple >=900.
   */

  versions.push({

    url: image.url,

    width: image.width,

    height: image.height,

    source: "Página actual",

    checked: true
  });


  /*
   * Si tiene enlace asociado,
   * buscamos versiones adicionales.
   */

  if (image.link) {

    try {

      statusText.textContent =
        `Buscando versión externa de la imagen ${number}...`;


      const externalVersions =
        await inspectExternalLink(
          image.link
        );


      for (
        const version of externalVersions
      ) {

        if (!version.url) {
          continue;
        }


        /*
         * Solo agregar versiones que
         * realmente cumplen >=900.
         */

        if (
          version.width >= MIN_SIZE ||
          version.height >= MIN_SIZE
        ) {

          versions.push({

            ...version,

            checked: false
          });
        }
      }

    } catch (error) {

      console.error(
        "Error en enlace externo:",
        error
      );
    }
  }


  /*
   * Eliminar duplicados.
   */

  const unique = [];

  const seen = new Set();


  versions.forEach(version => {

    const key =
      version.url?.split("#")[0];


    if (!key || seen.has(key)) {
      return;
    }


    seen.add(key);

    unique.push(version);
  });


  /*
   * Solo una versión seleccionada
   * inicialmente.
   *
   * La página actual queda seleccionada.
   */

  unique.forEach((version, index) => {

    version.checked =
      index === 0;
  });


  groups.push({

    number,

    versions: unique
  });


  renderResults();

  updateSelectedCounter();
}


// =====================================================
// ENLACE EXTERNO
// =====================================================

async function inspectExternalLink(url) {

  return new Promise(resolve => {

    chrome.runtime.sendMessage(

      {
        action: "inspectDestination",
        url
      },

      response => {

        if (
          !response ||
          !response.success
        ) {

          resolve([]);

          return;
        }


        resolve(
          response.versions || []
        );
      }
    );
  });
}


// =====================================================
// ESCANEO PRINCIPAL
// =====================================================

async function scan() {

  if (scanning) {
    return;
  }


  scanning = true;

  stopRequested = false;

  groups = [];


  scanButton.disabled = true;

  downloadButton.disabled = true;

  stopButton.style.display = "block";


  resultsContainer.innerHTML = "";


  statusText.textContent =
    "Escaneando toda la página...";


  progressText.textContent =
    "Buscando imágenes...";


  try {

    /*
     * PRIMERA ETAPA:
     * recorrer la página y recoger imágenes.
     */

    const result =
      await scanWholePage();


    if (stopRequested) {

      finishScan();

      return;
    }


    const images =
      result.validImages || [];


    progressText.textContent =
      `${images.length} imágenes de 900 px o más encontradas`;


    /*
     * SEGUNDA ETAPA:
     * procesar imágenes válidas.
     *
     * Aquí ya empezamos a mostrarlas.
     */

    let number = 0;


    for (const image of images) {

      if (stopRequested) {
        break;
      }


      number++;


      /*
       * Mostrar inmediatamente la imagen
       * de la página.
       */

      groups.push({

        number,

        versions: [

          {
            url: image.url,

            width: image.width,

            height: image.height,

            source: "Página actual",

            checked: true
          }

        ]
      });


      renderResults();

      updateSelectedCounter();


      /*
       * Buscar enlace externo después.
       */

      if (image.link) {

        try {

          const externalVersions =
            await inspectExternalLink(
              image.link
            );


          const group =
            groups[groups.length - 1];


          for (
            const version of externalVersions
          ) {

            if (!version.url) {
              continue;
            }


            if (
              version.width >= MIN_SIZE ||
              version.height >= MIN_SIZE
            ) {

              const duplicate =
                group.versions.some(
                  existing =>
                    existing.url.split("#")[0] ===
                    version.url.split("#")[0]
                );


              if (!duplicate) {

                group.versions.push({

                  ...version,

                  checked: false
                });
              }
            }
          }


          renderResults();

          updateSelectedCounter();

        } catch (error) {

          console.error(error);
        }
      }


      progressText.textContent =
        `${groups.length} imágenes encontradas · ${getSelectedCount()} seleccionadas`;
    }


    statusText.textContent =
      "Escaneo terminado.";


    updateSelectedCounter();


  } catch (error) {

    console.error(
      "Error durante el escaneo:",
      error
    );


    statusText.textContent =
      "Error durante el escaneo. Revisa la consola.";
  }


  scanning = false;

  scanButton.disabled = false;

  downloadButton.disabled = false;

  stopButton.style.display = "none";
}


// =====================================================
// DETENER
// =====================================================

function stopScan() {

  stopRequested = true;

  statusText.textContent =
    "Terminando el escaneo...";
}


// =====================================================
// RENDERIZAR
// =====================================================

function renderResults() {

  resultsContainer.innerHTML = "";


  groups.forEach(group => {

    const element =
      document.createElement("div");


    element.className =
      "image-group";


    let html = `

      <div class="image-title">
        IMAGEN ${group.number}
      </div>

    `;


    group.versions.forEach(
      (version, index) => {

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
                ${escapeHtml(
                  formatSize(
                    version.width,
                    version.height
                  )
                )}
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


    element.innerHTML = html;


    resultsContainer.appendChild(
      element
    );
  });


  /*
   * Reasignar eventos.
   */

  resultsContainer
    .querySelectorAll(
      'input[type="checkbox"]'
    )
    .forEach(checkbox => {

      checkbox.addEventListener(
        "change",
        () => {

          /*
           * Si el usuario marca una versión
           * diferente dentro del mismo grupo,
           * desmarcar la anterior.
           *
           * Así cada imagen representa
           * una sola descarga.
           */

          if (checkbox.checked) {

            const groupNumber =
              checkbox.dataset.group;


            resultsContainer
              .querySelectorAll(
                `input[data-group="${groupNumber}"]`
              )
              .forEach(other => {

                if (other !== checkbox) {
                  other.checked = false;
                }
              });
          }


          updateSelectedCounter();
        }
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

  const total =
    groups.length;


  const selected =
    getSelectedCount();


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
      "No hay imágenes seleccionadas.";

    return;
  }


  downloadButton.disabled = true;


  let count = 0;


  for (
    const checkbox of checkboxes
  ) {

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


    if (!group) {
      continue;
    }


    const version =
      group.versions[versionIndex];


    if (!version?.url) {
      continue;
    }


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
