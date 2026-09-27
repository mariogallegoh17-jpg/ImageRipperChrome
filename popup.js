const MIN_SIZE = 900;

const scanBtn =
  document.getElementById("scan");

const stopBtn =
  document.getElementById("stop");

const downloadBtn =
  document.getElementById("download");

const statusEl =
  document.getElementById("status");

const progressEl =
  document.getElementById("progress");

const resultsEl =
  document.getElementById("results");

let state = {
  scanning: false,
  groups: [],
  totalDetected: 0,
  validDetected: 0
};

function setStatus(text) {
  if (statusEl) {
    statusEl.textContent = text;
  }
}

function setProgress(text) {
  if (progressEl) {
    progressEl.textContent = text;
  }
}

function updateCounter() {

  const groups =
    state.groups || [];

  let selected = 0;

  for (const group of groups) {

    if (group.selectedUrl) {
      selected++;
    }
  }

  setProgress(
    `${groups.length} imágenes encontradas · ${selected} seleccionadas`
  );
}

function updateButtons() {

  if (scanBtn) {
    scanBtn.disabled =
      state.scanning;
  }

  if (stopBtn) {
    stopBtn.disabled =
      !state.scanning;
  }

  if (downloadBtn) {

    const hasSelected =
      (state.groups || [])
        .some(
          group =>
            !!group.selectedUrl
        );

    downloadBtn.disabled =
      state.scanning ||
      !hasSelected;
  }
}

function formatSize(width, height) {

  if (!width && !height) {
    return "Tamaño desconocido";
  }

  return `${width} × ${height}`;
}

function createOption(
  group,
  version,
  type
) {

  const label =
    document.createElement(
      "label"
    );

  label.className =
    "image-option";

  const radio =
    document.createElement(
      "input"
    );

  /*
    Radio en lugar de checkbox:
    una sola versión por grupo.
  */
  radio.type = "radio";

  radio.name =
    `group-${group.id}`;

  radio.value =
    version.url;

  radio.checked =
    group.selectedUrl ===
    version.url;

  const text =
    document.createElement(
      "span"
    );

  text.textContent =
    `${type} — ${formatSize(
      version.width,
      version.height
    )}`;

  label.appendChild(radio);
  label.appendChild(text);

  radio.addEventListener(
    "change",
    async () => {

      if (!radio.checked) {
        return;
      }

      group.selectedUrl =
        version.url;

      /*
        Guardamos inmediatamente
        la selección en background.
      */
      await chrome.runtime.sendMessage({
        action:
          "setSelection",
        groupId:
          group.id,
        selectedUrl:
          version.url
      });

      updateCounter();
      updateButtons();
    }
  );

  return label;
}

function renderResults() {

  if (!resultsEl) {
    return;
  }

  resultsEl.innerHTML = "";

  const groups =
    state.groups || [];

  let visibleGroups = 0;

  groups.forEach(
    (group, index) => {

      const page =
        group.page;

      const external =
        group.external || [];

      /*
        Solo mostramos grupos que tengan
        por lo menos una versión válida.
      */
      const pageValid =
        page &&
        (
          Number(page.width) >= MIN_SIZE ||
          Number(page.height) >= MIN_SIZE
        );

      const hasValidExternal =
        external.length > 0;

      if (
        !pageValid &&
        !hasValidExternal
      ) {
        return;
      }

      visibleGroups++;

      const container =
        document.createElement(
          "div"
        );

      container.className =
        "image-group";

      const title =
        document.createElement(
          "div"
        );

      title.className =
        "group-title";

      title.textContent =
        `Imagen ${visibleGroups}`;

      container.appendChild(
        title
      );

      /*
        Versión encontrada directamente
        en la página.
      */
      if (pageValid) {

        container.appendChild(
          createOption(
            group,
            {
              url: page.url,
              width: page.width,
              height: page.height
            },
            "Página"
          )
        );
      }

      /*
        Versiones externas.
      */
      external.forEach(
        (version, i) => {

          container.appendChild(
            createOption(
              group,
              version,
              `Externa ${i + 1}`
            )
          );
        }
      );

      resultsEl.appendChild(
        container
      );
    }
  );

  updateCounter();
  updateButtons();
}

async function getState() {

  try {

    const response =
      await chrome.runtime.sendMessage({
        action: "getState"
      });

    if (
      response &&
      response.success &&
      response.state
    ) {

      state =
        response.state;

      renderResults();

      updateButtons();

      if (state.scanning) {

        setStatus(
          "Escaneando toda la página…"
        );

      } else if (
        state.groups &&
        state.groups.length
      ) {

        setStatus(
          "Escaneo terminado."
        );

      } else {

        setStatus(
          "Listo para escanear."
        );
      }
    }

  } catch (error) {

    console.error(error);

    setStatus(
      "No se pudo recuperar el estado."
    );
  }
}

async function startScan() {

  /*
    Primero limpiamos el resultado anterior.
  */
  await chrome.runtime.sendMessage({
    action: "clearState"
  });

  state = {
    scanning: true,
    groups: [],
    totalDetected: 0,
    validDetected: 0
  };

  resultsEl.innerHTML = "";

  setStatus(
    "Preparando escaneo…"
  );

  setProgress(
    "0 imágenes encontradas · 0 seleccionadas"
  );

  updateButtons();

  try {

    const tabs =
      await chrome.tabs.query({
        active: true,
        currentWindow: true
      });

    if (!tabs.length) {
      throw new Error(
        "No hay una pestaña activa."
      );
    }

    const tab =
      tabs[0];

    /*
      Le pedimos al background que
      prepare el estado.
    */
    const prepared =
      await chrome.runtime.sendMessage({
        action: "startScan"
      });

    if (
      !prepared ||
      !prepared.success
    ) {
      throw new Error(
        "No se pudo iniciar el escaneo."
      );
    }

    /*
      El content script ya está instalado
      en la página.

      Le damos la orden de comenzar.
    */
    await chrome.tabs.sendMessage(
      tab.id,
      {
        action:
          "startScan"
      }
    );

    setStatus(
      "Escaneando toda la página…"
    );

  } catch (error) {

    console.error(error);

    state.scanning =
      false;

    setStatus(
      "No se pudo iniciar: " +
      error.message
    );

    updateButtons();
  }
}

async function stopScan() {

  try {

    const tabs =
      await chrome.tabs.query({
        active: true,
        currentWindow: true
      });

    if (!tabs.length) {
      return;
    }

    await chrome.tabs.sendMessage(
      tabs[0].id,
      {
        action:
          "stopScan"
      }
    );

    setStatus(
      "Deteniendo escaneo…"
    );

  } catch (error) {

    console.error(error);
  }
}

async function downloadSelected() {

  const selected =
    (state.groups || [])
      .filter(
        group =>
          group.selectedUrl
      );

  if (!selected.length) {

    setStatus(
      "No hay imágenes seleccionadas."
    );

    return;
  }

  setStatus(
    `Descargando 0/${selected.length}…`
  );

  let completed = 0;

  for (
    const group of selected
  ) {

    try {

      await chrome.downloads.download({
        url:
          group.selectedUrl,
        saveAs: false
      });

      completed++;

      setStatus(
        `Descargando ${completed}/${selected.length}…`
      );

    } catch (error) {

      console.error(
        "Error descargando:",
        group.selectedUrl,
        error
      );
    }
  }

  setStatus(
    `Descarga terminada: ${completed}/${selected.length}.`
  );
}

/*
  Mensajes que llegan mientras el popup
  está abierto.
*/
chrome.runtime.onMessage.addListener(
  message => {

    if (
      message.action ===
      "scanProgress"
    ) {

      state.totalDetected =
        message.count || 0;

      state.validDetected =
        message.validCount || 0;

      setStatus(
        `Escaneando… ${state.totalDetected} imágenes detectadas`
      );

      setProgress(
        `${state.totalDetected} detectadas · ${state.validDetected} cumplen ≥ 900 px`
      );

      return;
    }

    if (
      message.action ===
      "externalResult"
    ) {

      const group =
        state.groups.find(
          g =>
            g.id ===
            message.groupId
        );

      if (!group) {
        return;
      }

      group.external =
        message.external || [];

      group.selectedUrl =
        message.selectedUrl ||
        group.selectedUrl;

      renderResults();

      return;
    }

    if (
      message.action ===
      "scanFinished"
    ) {

      state.scanning =
        false;

      setStatus(
        "Escaneo terminado. Revisa las imágenes seleccionadas."
      );

      renderResults();

      updateButtons();

      return;
    }
  }
);

scanBtn.addEventListener(
  "click",
  startScan
);

stopBtn.addEventListener(
  "click",
  stopScan
);

downloadBtn.addEventListener(
  "click",
  downloadSelected
);

/*
  Al abrir el popup recuperamos
  lo que esté haciendo la extensión.
*/
getState();
