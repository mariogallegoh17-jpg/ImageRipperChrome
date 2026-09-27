let scanState = {
  scanning: false,
  tabId: null,
  groups: [],
  totalDetected: 0,
  validDetected: 0
};

async function saveState() {
  try {
    await chrome.storage.session.set({
      imageRipperState: scanState
    });
  } catch (error) {
    console.error(
      "Error guardando estado:",
      error
    );
  }
}

async function loadState() {
  try {
    const data =
      await chrome.storage.session.get(
        "imageRipperState"
      );

    if (data.imageRipperState) {
      scanState = data.imageRipperState;
    }
  } catch (error) {
    console.error(
      "Error cargando estado:",
      error
    );
  }
}

async function inspectTab(tabId) {

  const result =
    await chrome.scripting.executeScript({
      target: {
        tabId
      },

      func: () => {

        const found = new Map();

        function add(
          url,
          width = 0,
          height = 0
        ) {
          if (
            !url ||
            url.startsWith("data:")
          ) {
            return;
          }

          try {
            url = new URL(
              url,
              location.href
            ).href;
          } catch (_) {
            return;
          }

          const old =
            found.get(url);

          if (!old) {
            found.set(url, {
              url,
              width:
                Number(width) || 0,
              height:
                Number(height) || 0
            });
          } else {
            old.width =
              Math.max(
                old.width,
                Number(width) || 0
              );

            old.height =
              Math.max(
                old.height,
                Number(height) || 0
              );
          }
        }

        /*
          Meta OG.
        */
        document
          .querySelectorAll(
            'meta[property="og:image"], meta[name="twitter:image"]'
          )
          .forEach(meta => {
            add(meta.content);
          });

        /*
          Todas las imágenes reales.
        */
        document
          .querySelectorAll("img")
          .forEach(img => {

            add(
              img.currentSrc ||
              img.src,
              img.naturalWidth ||
              img.width,
              img.naturalHeight ||
              img.height
            );

            /*
              Atributos usados frecuentemente
              por sistemas de lazy-loading.
            */
            const attrs = [
              "data-src",
              "data-original",
              "data-original-src",
              "data-full",
              "data-full-image",
              "data-large",
              "data-large-image",
              "data-image",
              "data-lazy-src"
            ];

            for (const attr of attrs) {
              const value =
                img.getAttribute(attr);

              if (value) {
                add(value);
              }
            }

            /*
              srcset.
            */
            const srcset =
              img.getAttribute(
                "srcset"
              );

            if (srcset) {

              srcset
                .split(",")
                .forEach(part => {

                  const pieces =
                    part.trim()
                      .split(/\s+/);

                  if (pieces[0]) {
                    add(pieces[0]);
                  }
                });
            }
          });

        /*
          Enlaces directos a imágenes.
        */
        document
          .querySelectorAll("a[href]")
          .forEach(a => {

            const href =
              a.href || "";

            if (
              /\.(jpg|jpeg|png|webp|gif|avif|bmp)(\?|#|$)/i
                .test(href)
            ) {
              add(href);
            }
          });

        return Array.from(
          found.values()
        );
      }
    });

  return (
    result &&
    result[0] &&
    result[0].result
  ) || [];
}

async function inspectDestination(url) {

  if (!url) {
    return [];
  }

  let tab = null;

  try {

    tab =
      await chrome.tabs.create({
        url,
        active: false
      });

    const tabId = tab.id;

    /*
      Esperamos hasta 12 segundos por la carga.
    */
    const start =
      Date.now();

    while (
      Date.now() - start < 12000
    ) {

      try {
        const current =
          await chrome.tabs.get(tabId);

        if (
          current.status ===
          "complete"
        ) {
          break;
        }

      } catch (_) {
        break;
      }

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            250
          )
      );
    }

    /*
      Espera adicional para JavaScript,
      imágenes lazy y frameworks.
    */
    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          1500
        )
    );

    return await inspectTab(tabId);

  } catch (error) {

    console.error(
      "Error inspeccionando:",
      url,
      error
    );

    return [];

  } finally {

    if (tab) {

      try {
        await chrome.tabs.remove(
          tab.id
        );
      } catch (_) {}
    }
  }
}

async function processExternalLinks() {

  for (
    let i = 0;
    i < scanState.groups.length;
    i++
  ) {

    const group =
      scanState.groups[i];

    if (!group.link) {
      continue;
    }

    /*
      Si el enlace es exactamente la misma imagen,
      no tiene sentido revisarlo.
    */
    if (
      group.link ===
      group.page.url
    ) {
      continue;
    }

    try {

      const images =
        await inspectDestination(
          group.link
        );

      const valid =
        images.filter(
          image =>
            Number(image.width) >= 900 ||
            Number(image.height) >= 900
        );

      /*
        Eliminamos duplicados.
      */
      const unique = [];

      const urls =
        new Set();

      for (const image of valid) {

        if (
          urls.has(image.url)
        ) {
          continue;
        }

        urls.add(image.url);

        unique.push({
          url: image.url,
          width:
            Number(image.width) || 0,
          height:
            Number(image.height) || 0
        });
      }

      group.external =
        unique;

      /*
        Si la página NO tenía una imagen válida,
        seleccionamos automáticamente la primera
        versión externa válida encontrada.

        Si la página sí era válida, mantenemos
        seleccionada esa versión.
      */
      if (
        !group.selectedUrl &&
        unique.length
      ) {
        group.selectedUrl =
          unique[0].url;
      }

      await saveState();

      chrome.runtime.sendMessage({
        action:
          "externalResult",
        groupId:
          group.id,
        external:
          unique,
        selectedUrl:
          group.selectedUrl
      }).catch(() => {});

    } catch (error) {

      console.error(
        "Error procesando enlace externo:",
        error
      );
    }
  }

  scanState.scanning = false;

  await saveState();

  chrome.runtime.sendMessage({
    action: "scanFinished"
  }).catch(() => {});
}

chrome.runtime.onMessage.addListener(
  async (message, sender, sendResponse) => {

    if (
      message.action ===
      "startScan"
    ) {

      await loadState();

      scanState = {
        scanning: true,
        tabId:
          sender.tab?.id || null,
        groups: [],
        totalDetected: 0,
        validDetected: 0
      };

      await saveState();

      sendResponse({
        success: true
      });

      return true;
    }

    if (
      message.action ===
      "scanProgress"
    ) {

      scanState.totalDetected =
        Number(
          message.count
        ) || 0;

      scanState.validDetected =
        Number(
          message.validCount
        ) || 0;

      await saveState();

      chrome.runtime.sendMessage({
        action:
          "scanProgress",
        count:
          scanState.totalDetected,
        validCount:
          scanState.validDetected
      }).catch(() => {});

      return true;
    }

    if (
      message.action ===
      "scanComplete"
    ) {

      scanState.groups =
        message.groups || [];

      scanState.totalDetected =
        Number(
          message.totalDetected
        ) || 0;

      scanState.validDetected =
        Number(
          message.validDetected
        ) || 0;

      await saveState();

      /*
        Respondemos inmediatamente.
        El procesamiento de enlaces externos
        continúa en background.
      */
      sendResponse({
        success: true
      });

      processExternalLinks();

      return true;
    }

    if (
      message.action ===
      "getState"
    ) {

      await loadState();

      sendResponse({
        success: true,
        state: scanState
      });

      return true;
    }

    if (
      message.action ===
      "setSelection"
    ) {

      await loadState();

      const group =
        scanState.groups.find(
          g =>
            g.id ===
            message.groupId
        );

      if (group) {

        group.selectedUrl =
          message.selectedUrl ||
          null;

        await saveState();
      }

      sendResponse({
        success: true
      });

      return true;
    }

    if (
      message.action ===
      "clearState"
    ) {

      scanState = {
        scanning: false,
        tabId: null,
        groups: [],
        totalDetected: 0,
        validDetected: 0
      };

      await saveState();

      sendResponse({
        success: true
      });

      return true;
    }

    /*
      Compatibilidad con la función anterior.
    */
    if (
      message.action ===
      "inspectDestination"
    ) {

      try {

        const images =
          await inspectDestination(
            message.url
          );

        sendResponse({
          success: true,
          images
        });

      } catch (error) {

        sendResponse({
          success: false,
          images: [],
          error:
            error.message
        });
      }

      return true;
    }
  }
);

loadState();
