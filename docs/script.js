const ELEMENTS = {
  themeToggle: document.querySelector("#theme-toggle"),
  pageScroll: document.querySelector(".page-scroll"),
  content: document.querySelector("main[aria-label='Content']"),
  previousPage: document.querySelector("#previous-page"),
  nextPage: document.querySelector("#next-page")
}

const THEME_STORAGE_KEY = "theme";
const SYSTEM_THEME = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
const DEFAULT_PAGE = "Navigation.md";
const CONTENTS_API = "https://api.github.com/repos/sMaptic/Documentation/contents/contents";
const PAGE_INDEX = new Map();
const ASSET_INDEX = new Map();

let assetBaseUrl = "../assets/";

// set the theme based on stored preference or system preference
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  ELEMENTS.themeToggle.querySelector("span").textContent = theme === "dark" ? "☀" : "☾";
  ELEMENTS.themeToggle.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
}

const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
setTheme(storedTheme === "dark" || storedTheme === "light" ? storedTheme : SYSTEM_THEME);


// listen for theme button clicked and toggle theme
ELEMENTS.themeToggle.addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  setTheme(nextTheme);
});


// update padding based on scrollbar visibility
function updateScrollbarPadding() {
  ELEMENTS.pageScroll.classList.toggle(
    "has-scrollbar",
    ELEMENTS.pageScroll.scrollHeight > ELEMENTS.pageScroll.clientHeight
  );
}


// observers for scrollbar visibility and content size changes to update padding
new ResizeObserver(updateScrollbarPadding).observe(ELEMENTS.pageScroll);
new ResizeObserver(updateScrollbarPadding).observe(ELEMENTS.content);


// registers case-insensitive index key with page info to page index
function addPageToIndex(title, path, downloadUrl) {
  PAGE_INDEX.set(title.toLowerCase(), { title, path, downloadUrl });
}


// attempt to load documentation and assets from github contents api
async function loadFromGitHubContents() {
  assetBaseUrl = "https://raw.githubusercontent.com/sMaptic/Documentation/main/assets/";
  ASSET_INDEX.clear();
  // grab assets
  try {
    const assetsResponse = await fetch("https://api.github.com/repos/sMaptic/Documentation/contents/assets");
    if (assetsResponse.ok) {
      const assets = await assetsResponse.json();
      for (const asset of assets) {
        if (asset.type === "file") {
          ASSET_INDEX.set(asset.name.toLowerCase(), asset.download_url);
        }
      }
    }
  } catch (error) {
    console.warn(error.message, "- asset download URLs unavailable");
  }

  // grab documentation
  async function scanDirectory(directoryUrl, relativeDirectory = "") {
    const response = await fetch(directoryUrl);
    if (!response.ok) {
      throw new Error(`GitHub Contents API returned ${response.status}`);
    }

    const entries = await response.json();
    for (const entry of entries) {
      if (entry.type === "file" && entry.name.toLowerCase().endsWith(".md")) {
        const title = entry.name.replace(/\.md$/i, "");
        const path = `${relativeDirectory}${entry.name}`;
        addPageToIndex(title, path, entry.download_url);
      } else if (entry.type === "dir") {
        await scanDirectory(entry.url, `${relativeDirectory}${entry.name}/`);
      }
    }
  }

  await scanDirectory(CONTENTS_API);
}


// clear assets and load from docs.json in the event that contents api fails. useful for testing
async function loadFromStaticList() {
  assetBaseUrl = "../assets/";
  ASSET_INDEX.clear();
  const response = await fetch("./docs.json");
  if (!response.ok) {
    throw new Error(`Could not load docs.json (${response.status})`);
  }

  const paths = await response.json();
  for (const path of paths) {
    const title = path.split("/").pop().replace(/\.md$/i, "");
    const downloadUrl = `../contents/${path.split("/").map(encodeURIComponent).join("/")}`;
    addPageToIndex(title, path, downloadUrl);
  }
}


// load documentation with github content api first with fallback to docs.json 
async function initializePageIndex() {
  try {
    await loadFromGitHubContents();
  } catch (error) {
    PAGE_INDEX.clear();
    console.warn(error.message, " - using docs.json fallback");
    await loadFromStaticList();
  }

  // keep the navigation page first in the page index
  const navigationPage = PAGE_INDEX.get(DEFAULT_PAGE.replace(/\.md$/i, "").toLowerCase());
  if (!navigationPage) {
    return;
  }

  const orderedPages = [
    navigationPage,
    ...[...PAGE_INDEX.values()].filter((page) => page !== navigationPage)
  ];

  PAGE_INDEX.clear();
  for (const page of orderedPages) {
    PAGE_INDEX.set(page.title.toLowerCase(), page);
  }
}


// convert [[page]] links into hash links when target exists in page index
function resolveMarkdownLinks(markdown) {
  return markdown.replace(/\[\[([^\]|]+)\]\]/g, (match, target) => {
    const page = PAGE_INDEX.get(target.trim().toLowerCase());
    if (page) {
      return `[${target.trim()}](#/${encodeURIComponent(page.path)})`;
    }
    return match;
  });
}


// Convert relative image paths into standard image links
function resolveMarkdownImages(markdown) {
  let resolved = markdown
    .replace(/!\[\[([^\]]+)\]\]/g, (match, filename) => {
      const imageUrl = getAssetUrl(filename.trim());
      return `![${filename.trim()}](${imageUrl})`;
    })
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, source) => {
      const trimmedSource = source.trim();
      if (/^(?:https?:|data:)/i.test(trimmedSource) || trimmedSource.startsWith("/")) {
        return match;
      }
      return `![${alt}](${getAssetUrl(trimmedSource)})`;
    });

  // ensures image link doesnt affect blocks above or below because my implementation sucks
  resolved = resolved.replace(
    /(^|\n)[ \t]*(!\[(?:[^\]]*)\]\(([^)]+)\))[ \t]*(?=\n|$)/g,
    (match, lineStart, imageMarkdown, imageSource) => {
      return `${lineStart}\n${imageMarkdown}\n`;
    }
  );

  return resolved;
}


// get asset path from github content or just convert existing relative asset path on fail
function getAssetUrl(filename) {
  return ASSET_INDEX.get(filename.split("/").pop().toLowerCase())
    || `${assetBaseUrl}${filename.split("/").map(encodeURIComponent).join("/")}`;
}


// update the previous and next buttons based on the active page in the page index
function updatePageNavigation(activePage) {
  const pages = [...PAGE_INDEX.values()];
  const activeIndex = pages.findIndex((page) => page.path === activePage.path);
  const previousPage = activeIndex > 0 ? pages[activeIndex - 1] : null;
  const nextPage = activeIndex >= 0 && activeIndex < pages.length - 1 ? pages[activeIndex + 1] : null;

  ELEMENTS.previousPage.disabled = !previousPage;
  ELEMENTS.nextPage.disabled = !nextPage;

  ELEMENTS.previousPage.onclick = previousPage
    ? () => { location.hash = `/${encodeURIComponent(previousPage.path).replace(/%2F/g, "/")}`; }
    : null;
  ELEMENTS.nextPage.onclick = nextPage
    ? () => { location.hash = `/${encodeURIComponent(nextPage.path).replace(/%2F/g, "/")}`; }
    : null;
}


// load active documentaion page in the fragment identifier
async function loadPage() {
  if (!PAGE_INDEX.size) {
    await initializePageIndex();
  }

  // extract the requested markdown filename from the fragment identifier with fallback to the navigation page
  const requestedTitle = decodeURIComponent(location.hash.replace(/^#\/?/, "")).trim() || DEFAULT_PAGE.replace(/\.md$/i, "");
  const page = PAGE_INDEX.get(requestedTitle.replace(/\.md$/i, "").toLowerCase())
    || [...PAGE_INDEX.values()].find((candidate) =>
      candidate.path.toLowerCase() === requestedTitle.toLowerCase()
    )
    || PAGE_INDEX.get(DEFAULT_PAGE.replace(/\.md$/i, "").toLowerCase());

  if (!page) {
    ELEMENTS.content.innerHTML = "<p>Documentation page not found.</p>";
    ELEMENTS.previousPage.disabled = true;
    ELEMENTS.nextPage.disabled = true;
    return;
  }

  updatePageNavigation(page);
  ELEMENTS.content.innerHTML = '<p class="content-loading">Loading documentation...</p>';

  try {
    // build html page converted from markdown
    const response = await fetch(page.downloadUrl);
    if (!response.ok) {
      throw new Error(`Could not load ${page.title} (${response.status})`);
    }
    const markdown = await response.text();
    ELEMENTS.content.innerHTML = marked.parse(resolveMarkdownLinks(resolveMarkdownImages(markdown)));

    const titleHeading = document.createElement("h2");
    titleHeading.textContent = page.title;
    ELEMENTS.content.prepend(titleHeading);

    // internal links refresh and load new page, external links open in new tab
    ELEMENTS.content.querySelectorAll("a").forEach((link) => {
      if (link.getAttribute("href")?.startsWith("#/")) {
        const navigationPage = PAGE_INDEX.get(DEFAULT_PAGE.replace(/\.md$/i, "").toLowerCase());
        if (link.getAttribute("href") === (navigationPage ? `#/${encodeURIComponent(navigationPage.path)}` : null)) {
          link.classList.add("navigation-link");
        }

        link.addEventListener("click", () => {
          ELEMENTS.pageScroll.scrollTop = 0;
        });
      } else {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
      }
    });
    ELEMENTS.pageScroll.scrollTop = 0;
    updateScrollbarPadding();
    // document.title = `sMaptic - ${page.title}`;
  } catch (error) {
    ELEMENTS.content.innerHTML = `<p>${error.message}</p>`;
  }
}


// listen for back/forward requests to replace current page
window.addEventListener("hashchange", () => {
  loadPage().catch((error) => {
    ELEMENTS.content.innerHTML = `<p>${error.message}</p>`;
  });
});


// route to navigation page if fragment identifier is empty and overwrite browser history entry
if (!location.hash) {
  history.replaceState(null, "", `#/${DEFAULT_PAGE.replace(/\.md$/i, "")}`);
}


// load initial page
loadPage().catch((error) => {
  ELEMENTS.content.innerHTML = `<p>${error.message}</p>`;
});
