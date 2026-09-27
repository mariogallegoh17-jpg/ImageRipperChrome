const MIN_SIZE = 900;

const scanButton = document.getElementById("scan");
const downloadButton = document.getElementById("download");

const resultsContainer = document.getElementById("results");
const statusText = document.getElementById("status");

let groups = [];

function validSize(width, height) {
  return width >= MIN_SIZE || height >= MIN_SIZE;
}

function formatSize(width, height) {

  if (width && height) {
    return `${width} × ${height}`;
  }

  return "Dimensiones no detectadas";
}

function escapeHtml(text) {

  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function getPageImages() {

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id },

    func: () => {

      const images = [];

      document.querySelectorAll("img").forEach((img, index) => {

        const width = img.naturalWidth || img.width || 0;
        const height = img.naturalHeight || img.height || 0;

        let link = "";

        const anchor = img.closest("a");

        if (anchor) {
          link = anchor.href || "";
        }

        images.push({
          index,
          url: img.currentSrc || img.src,
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

async function scan() {

  resultsContainer.innerHTML = "";
  groups = [];

  statusText.textContent = "Analizando imágenes...";

  const images = await getPageImages();

  let groupNumber = 0;

  for (const image of images) {

    const versions = [];

    // Imagen de la página actual
    if (validSize(image.width, image.height)) {

      versions.push({
        url: image.url,
        width: image.width,
        height: image.height,
        source: "Página actual",
        checked: true
      });
    }

    // Buscar versiones en enlace externo
    if (image.link) {

      const externalVersions =
        await inspectExternalLink(image.link);

      externalVersions.forEach(version => {

        if (
          validSize(version.width, version.height) ||
          version.width === 0 ||
          version.height === 0
        ) {

          versions.push({
            ...version,
            checked: false
          });
        }
      });
    }

    // Eliminar duplicados
    const unique = [];
    const seen = new Set();

    versions.forEach(version => {

      if (!version.url) return;

      const key = version.url.split("#")[0];

      if (seen.has(key)) return;

      seen.add(key);
      unique.push(version);
    });

    if (!unique.length) continue;

    groupNumber++;

    groups.push({
      number: groupNumber,
      versions: unique
    });
  }

  renderResults();

  statusText.textContent =
    `${groups.length} imagen(es) encontrada(s)`;
}

function renderResults() {

  resultsContainer.innerHTML = "";

  groups.forEach(group => {

    const groupElement =
      document.createElement("div");

    groupElement.className = "image-group";

    let html = `
      <div class="image-title">
        IMAGEN ${group.number}
      </div>
    `;

    group.versions.forEach((version, index) => {

      const size =
        formatSize(version.width, version.height);

      html += `
        <label class="version">
          <input
            type="checkbox"
            data-group="${group.number}"
            data-version="${index}"
            ${version.checked ? "checked" : ""}
          >

          <span>
            <strong>${escapeHtml(size)}</strong>
            <br>
            <small>${escapeHtml(version.source || "Versión encontrada")}</small>
          </span>
        </label>
      `;
    });

    groupElement.innerHTML = html;

    resultsContainer.appendChild(groupElement);
  });
}

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

  let count = 0;

  for (const checkbox of checkboxes) {

    const groupNumber =
      Number(checkbox.dataset.group);

    const versionIndex =
      Number(checkbox.dataset.version);

    const group =
      groups.find(g => g.number === groupNumber);

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

    } catch (error) {

      console.error(
        "No se pudo descargar:",
        version.url,
        error
      );
    }
  }

  statusText.textContent =
    `${count} descarga(s) iniciada(s).`;
}

scanButton.addEventListener("click", scan);

downloadButton.addEventListener(
  "click",
  downloadSelected
);
