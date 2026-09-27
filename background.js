const MIN_SIZE = 900;

function validSize(width, height) {
  return (width >= MIN_SIZE || height >= MIN_SIZE);
}

function uniqueVersions(versions) {
  const seen = new Set();

  return versions.filter(v => {
    if (!v.url) return false;

    const key = v.url.split("#")[0];

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

async function inspectTab(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {

        const found = [];

        function add(url, width = 0, height = 0, source = "") {
          if (!url) return;

          try {
            url = new URL(url, location.href).href;
          } catch {
            return;
          }

          found.push({
            url,
            width: Number(width) || 0,
            height: Number(height) || 0,
            source
          });
        }

        // IMG reales
        document.querySelectorAll("img").forEach(img => {

          const width = img.naturalWidth || img.width || 0;
          const height = img.naturalHeight || img.height || 0;

          add(
            img.currentSrc || img.src,
            width,
            height,
            "Página de destino"
          );

          // srcset
          if (img.srcset) {
            const candidates = img.srcset
              .split(",")
              .map(x => x.trim());

            candidates.forEach(candidate => {
              const parts = candidate.split(/\s+/);
              const url = parts[0];
              const descriptor = parts[1] || "";

              let w = 0;
              let h = 0;

              if (descriptor.endsWith("w")) {
                w = parseInt(descriptor);
              }

              add(url, w, h, "srcset");
            });
          }

          // atributos comunes
          [
            "data-original",
            "data-original-src",
            "data-full",
            "data-full-image",
            "data-large",
            "data-large-image",
            "data-image",
            "data-src"
          ].forEach(attr => {
            const value = img.getAttribute(attr);

            if (value) {
              add(value, 0, 0, attr);
            }
          });
        });

        // Picture / source
        document.querySelectorAll("source").forEach(source => {

          const srcset = source.getAttribute("srcset");

          if (!srcset) return;

          srcset.split(",").forEach(candidate => {

            const parts = candidate.trim().split(/\s+/);

            const url = parts[0];
            const descriptor = parts[1] || "";

            let width = 0;

            if (descriptor.endsWith("w")) {
              width = parseInt(descriptor);
            }

            add(
              url,
              width,
              0,
              "picture/source"
            );
          });
        });

        // Open Graph
        document.querySelectorAll(
          'meta[property="og:image"], meta[name="twitter:image"]'
        ).forEach(meta => {

          add(
            meta.content,
            0,
            0,
            "Meta de página"
          );
        });

        // Enlaces directos a imágenes
        document.querySelectorAll("a[href]").forEach(a => {

          const href = a.href;

          if (/\.(jpg|jpeg|png|webp|gif|avif)(\?.*)?$/i.test(href)) {
            add(
              href,
              0,
              0,
              "Enlace directo"
            );
          }
        });

        return found;
      }
    });

    return results?.[0]?.result || [];

  } catch (error) {
    console.error("Error inspeccionando pestaña:", error);
    return [];
  }
}

async function inspectDestination(url) {

  let tab = null;

  try {

    tab = await chrome.tabs.create({
      url,
      active: false
    });

    await new Promise(resolve => {

      const listener = (tabId, info) => {

        if (
          tabId === tab.id &&
          info.status === "complete"
        ) {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };

      chrome.tabs.onUpdated.addListener(listener);

      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 10000);
    });

    // Dar tiempo para contenido dinámico
    await new Promise(resolve => setTimeout(resolve, 1500));

    const versions = await inspectTab(tab.id);

    return versions;

  } catch (error) {

    console.error("Error abriendo destino:", error);

    return [];

  } finally {

    if (tab?.id) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {}
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === "inspectDestination") {

    inspectDestination(message.url)
      .then(versions => {

        sendResponse({
          success: true,
          versions
        });

      })
      .catch(error => {

        sendResponse({
          success: false,
          error: error.message
        });

      });

    return true;
  }
});
