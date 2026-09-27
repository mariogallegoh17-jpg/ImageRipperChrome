const MIN_SIZE = 900;

let scanning = false;
let results = [];
let selectedCount = 0;

const scanBtn = document.getElementById("scan");
const stopBtn = document.getElementById("stop");
const downloadBtn = document.getElementById("download");
const statusEl = document.getElementById("status");
const progressEl = document.getElementById("progress");
const resultsEl = document.getElementById("results");

function validSize(width, height) {
  return width >= MIN_SIZE || height >= MIN_SIZE;
}

function updateProgress(text) {
  if (progressEl) progressEl.textContent = text;
}

function updateStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function updateCounter() {
  const total = results.length;
  selectedCount = results.filter(x => x.selected).length;

  updateProgress(
    `${total} imágenes encontradas · ${selectedCount} seleccionadas`
  );
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tabs.length) {
    throw new Error("No se encontró la pestaña activa.");
  }

  return tabs[0];
}

/*
  ESTA FUNCIÓN HACE TODO EL ESCANEO DENTRO DE LA PÁGINA.

  Esto es importante:
  el popup ya no intenta controlar cada paso del scroll.
  La página se encarga de desplazarse, esperar la carga lazy,
  detectar imágenes y acumularlas.
*/
async function scanPage(tabId) {
  return await chrome.scripting.executeScript({
    target: { tabId },

    func: async () => {
      const MIN_SIZE = 900;

      const found = new Map();

      function validSize(w, h) {
        return w >= MIN_SIZE || h >= MIN_SIZE;
      }

      function addImage(img) {
        if (!img) return;

        const url = img.currentSrc || img.src;

        if (!url || url.startsWith("data:")) return;

        const width =
          img.naturalWidth ||
          img.width ||
          0;

        const height =
          img.naturalHeight ||
          img.height ||
          0;

        const anchor = img.closest("a");
        const link = anchor?.href || "";

        const key = `${url}|${link}`;

        if (!found.has(key)) {
          found.set(key, {
            url,
            link,
            width,
            height
          });
        } else {
          const old = found.get(key);

          if (width > old.width || height > old.height) {
            old.width = Math.max(old.width, width);
            old.height = Math.max(old.height, height);
          }
        }
      }

      function collect() {
        document.querySelectorAll("img").forEach(addImage);

        /*
          También revisamos imágenes que estén apareciendo
          dentro de picture/source.
        */
        document.querySelectorAll("picture source").forEach(source => {
          const srcset = source.srcset;

          if (!srcset) return;

          const entries = srcset.split(",");

          entries.forEach(entry => {
            const parts = entry.trim().split(/\s+/);
            const url = parts[0];

            if (!url) return;

            try {
              const absolute = new URL(url, location.href).href;

              const key = `${absolute}|`;

              if (!found.has(key)) {
                found.set(key, {
                  url: absolute,
                  link: "",
                  width: 0,
                  height: 0
                });
              }
            } catch (_) {}
          });
        });
      }

      const originalScroll = window.scrollY;

      collect();

      let lastHeight = 0;
      let stableBottomRounds = 0;

      /*
        Recorremos TODA la página.

        Cada paso:
        1. hacemos scroll
        2. esperamos
        3. dejamos que carguen las imágenes
        4. volvemos a recogerlas
      */

      for (let i = 0; i < 300; i++) {
        if (window.__IMAGE_RIPPER_STOP__) {
          break;
        }

        collect();

        const viewport = window.innerHeight || 800;

        window.scrollBy(0, Math.max(500, viewport * 0.8));

        await new Promise(resolve => setTimeout(resolve, 600));

        /*
          Espera adicional para lazy-loading.
        */
        collect();

        await new Promise(resolve => setTimeout(resolve, 300));

        collect();

        const currentHeight =
          document.documentElement.scrollHeight;

        const atBottom =
          window.innerHeight + window.scrollY >=
          currentHeight - 20;

        if (atBottom) {
          /*
            Damos varias oportunidades para que aparezcan
            nuevas imágenes al llegar al final.
          */
          if (currentHeight === lastHeight) {
            stableBottomRounds++;
          } else {
            stableBottomRounds = 0;
          }

          lastHeight = currentHeight;

          if (stableBottomRounds >= 5) {
            break;
          }
        }
      }

      collect();

      /*
        Volvemos arriba para no dejarle la página al usuario
        en una posición diferente.
      */
      window.scrollTo(0, originalScroll);

      await new Promise(resolve => setTimeout(resolve, 300));

      const all = Array.from(found.values());

      /*
        SOLO imágenes que cumplen:
        ancho >= 900 O alto >= 900
      */
      const valid = all.filter(item =>
        validSize(item.width, item.height)
      );

      return {
        totalDetected: all.length,
        validImages: valid
      };
    }
  });
}

function createGroup(item, index) {
  const group = document.createElement("div");
  group.className = "image-group";

  const title = document.createElement("div");
  title.className = "group-title";

  title.textContent =
    `Imagen ${index + 1} — ${item.width} × ${item.height}`;

  group.appendChild(title);

  /*
    Versión encontrada directamente en la página.
    ESTA QUEDA SELECCIONADA AUTOMÁTICAMENTE.
  */
  const option = document.createElement("label");
  option.className = "image-option";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = true;

  const text = document.createElement("span");
  text.textContent =
    `Página — ${item.width} × ${item.height}`;

  option.appendChild(checkbox);
  option.appendChild(text);

  group.appendChild(option);

  const record = {
    url: item.url,
    width: item.width,
    height: item.height,
    selected: true,
    checkbox
  };

  results.push(record);

  checkbox.addEventListener("change", () => {
    record.selected = checkbox.checked;
    updateCounter();
  });

  resultsEl.appendChild(group);

  /*
    IMPORTANTE:
    Si existe un enlace externo, NO lo seleccionamos todavía.
    Primero dejamos seleccionada la imagen válida encontrada.
  */

  if (item.link && item.link !== item.url) {
    const external = document.createElement("div");

    external.className = "external-status";
    external.textContent = "Buscando versión externa…";

    group.appendChild(external);

    inspectExternal(item.link, group, record, external);
  }
}

async function inspectExternal(url, group, pageRecord, statusNode) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: "inspectDestination",
      url
    });

    if (!response || !response.success) {
      statusNode.textContent = "No se encontró versión externa.";
      return;
    }

    const versions = response.images || [];

    const validVersions = versions.filter(v =>
      validSize(
        Number(v.width) || 0,
        Number(v.height) || 0
      )
    );

    if (!validVersions.length) {
      statusNode.textContent = "No hay una versión externa ≥ 900 px.";
      return;
    }

    statusNode.remove();

    validVersions.forEach((version, i) => {
      const option = document.createElement("label");
      option.className = "image-option";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";

      /*
        La versión de la página ya está seleccionada.
        Las externas empiezan SIN seleccionar.
      */
      checkbox.checked = false;

      const width = Number(version.width) || 0;
      const height = Number(version.height) || 0;

      const text = document.createElement("span");

      text.textContent =
        `Externa ${i + 1} — ${width} × ${height}`;

      option.appendChild(checkbox);
      option.appendChild(text);

      group.appendChild(option);

      const record = {
        url: version.url,
        width,
        height,
        selected: false,
        checkbox
      };

      results.push(record);

      checkbox.addEventListener("change", () => {
        /*
          Una sola versión por grupo.
        */
        if (checkbox.checked) {
          group
            .querySelectorAll('input[type="checkbox"]')
            .forEach(other => {
              if (other !== checkbox) {
                other.checked = false;

                const otherRecord =
                  results.find(r => r.checkbox === other);

                if (otherRecord) {
                  otherRecord.selected = false;
                }
              }
            });
        }

        /*
          Si selecciona una externa,
          deseleccionamos la versión de página.
        */
        pageRecord.selected = pageRecord.checkbox.checked;

        record.selected = checkbox.checked;

        updateCounter();
      });
    });

    updateCounter();

  } catch (error) {
    statusNode.textContent =
      "No se pudo revisar el enlace externo.";
  }
}

async function scan() {
  if (scanning) return;

  scanning = true;
  results = [];

  resultsEl.innerHTML = "";
  updateProgress("0 imágenes encontradas · 0 seleccionadas");
  updateStatus("Escaneando toda la página…");

  scanBtn.disabled = true;
  downloadBtn.disabled = true;
  stopBtn.disabled = false;

  try {
    const tab = await getActiveTab();

    /*
      Reiniciamos la bandera de parada.
    */
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        window.__IMAGE_RIPPER_STOP__ = false;
      }
    });

    const execution = await scanPage(tab.id);

    const data = execution?.[0]?.result;

    if (!data) {
      throw new Error("No se recibió el resultado del escaneo.");
    }

    updateStatus(
      `Escaneo terminado. ${data.validImages.length} imágenes válidas.`
    );

    /*
      AQUÍ se crean las imágenes y se marcan
      automáticamente como seleccionadas.
    */
    data.validImages.forEach((item, index) => {
      createGroup(item, index);
    });

    updateCounter();

    downloadBtn.disabled = results.length === 0;

  } catch (error) {
    console.error(error);

    updateStatus(
      "Error durante el escaneo: " + error.message
    );

  } finally {
    scanning = false;
    scanBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

async function stopScan() {
  if (!scanning) return;

  try {
    const tab = await getActiveTab();

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        window.__IMAGE_RIPPER_STOP__ = true;
      }
    });

    updateStatus("Deteniendo escaneo…");

  } catch (error) {
    console.error(error);
  }
}

async function downloadSelected() {
  const selected = results.filter(item => item.selected);

  if (!selected.length) {
    updateStatus("No hay imágenes seleccionadas.");
    return;
  }

  updateStatus(
    `Descargando ${selected.length} imágenes…`
  );

  let completed = 0;

  for (const item of selected) {
    try {
      await chrome.downloads.download({
        url: item.url,
        saveAs: false
      });

      completed++;

      updateStatus(
        `Descargando… ${completed}/${selected.length}`
      );

    } catch (error) {
      console.error(
        "Error descargando:",
        item.url,
        error
      );
    }
  }

  updateStatus(
    `Descarga terminada: ${completed}/${selected.length}.`
  );
}

scanBtn.addEventListener("click", scan);
stopBtn.addEventListener("click", stopScan);
downloadBtn.addEventListener("click", downloadSelected);

updateCounter();
