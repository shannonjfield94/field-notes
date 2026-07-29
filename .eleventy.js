const markdownIt = require("markdown-it")();

module.exports = function(eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/css");
  eleventyConfig.addPassthroughCopy("src/images");
  eleventyConfig.addPassthroughCopy("src/assets/favicons");
  eleventyConfig.addPassthroughCopy("src/favicon.ico");
  eleventyConfig.addFilter("markdownify", (content) => markdownIt.renderInline(content));

  eleventyConfig.addFilter("byGeneration", (people, gen) => {
    return people
      .filter(p => p.url !== "/people/" && p.data.direct_line && p.data.generation === gen)
      .sort((a, b) => (a.data.name || "").localeCompare(b.data.name || ""));
  });

  eleventyConfig.addFilter("groupCollateralBySurname", (people) => {
    const collateral = people.filter(p => p.url !== "/people/" && !p.data.direct_line);
    const groups = {};
    collateral.forEach(p => {
      const surname = p.data.surname || "Other";
      if (!groups[surname]) groups[surname] = [];
      groups[surname].push(p);
    });
    return Object.keys(groups)
      .sort()
      .map(surname => ({
        surname,
        people: groups[surname].sort((a, b) => (a.data.name || "").localeCompare(b.data.name || ""))
      }));
  });

  // --- Citation / Sources system ---
  const sourcesData = require('./src/_data/sources.json');

  // One citation list per page, reset at the start of every build/rebuild
  const citationRegistry = new Map();

  function getPageRegistry(inputPath) {
    if (!citationRegistry.has(inputPath)) {
      citationRegistry.set(inputPath, { list: [], nextGroup: 1 });
    }
    return citationRegistry.get(inputPath);
  }

  function registerCitesAndLabel(registry, entries) {
    const parsed = entries.map(entry => {
      const [key, detail] = entry.split("::").map(s => s && s.trim());
      return { key, detail };
    });

    const newEntries = [];
    const resolved = parsed.map(p => {
      const existing = registry.list.find(c => c.key === p.key);
      if (existing) return existing.label;
      newEntries.push(p);
      return null;
    });

    let groupNumber = newEntries.length ? registry.nextGroup++ : null;
    const useLetters = newEntries.length > 1;
    let newIndex = 0;

    return resolved.map((label, i) => {
      if (label !== null) return label;
      const letter = useLetters ? String.fromCharCode(97 + newIndex) : "";
      const newLabel = `${groupNumber}${letter}`;
      registry.list.push({ key: parsed[i].key, detail: parsed[i].detail, label: newLabel });
      newIndex++;
      return newLabel;
    });
  }

  function markerHtml(label) {
    return `<sup class="cite-marker"><a href="#ref-${label}" id="citeback-${label}">${label}</a></sup>`;
  }

  eleventyConfig.on('eleventy.before', () => citationRegistry.clear());

  // Usage: {% cite "source-key" %}
  //        {% cite "source-key::optional detail text" %}
  //        {% cite "key-a::detail a", "key-b::detail b" %}  <- renders as grouped Na/Nb
  eleventyConfig.addShortcode("cite", function (...entries) {
    if (entries.length === 1 && Array.isArray(entries[0])) entries = entries[0];
    const registry = getPageRegistry(this.page.inputPath);
    const labels = registerCitesAndLabel(registry, entries);
    return labels.map(markerHtml).join(",");
  });

  // Usage: {{ note | citeInline | safe }}  -- note text contains [[cite:source-key]] tokens
  eleventyConfig.addFilter("citeInline", function (text) {
    if (!text) return text;
    const registry = getPageRegistry(this.page.inputPath);
    return text.replace(/\[\[cite:([^\]]+)\]\]/g, (_, entry) => {
      const [label] = registerCitesAndLabel(registry, [entry]);
      return markerHtml(label);
    });
  });

  // Usage: {% citeReferences %}  -- call once, near the bottom of the page
  eleventyConfig.addShortcode("citeReferences", function () {
    const registry = getPageRegistry(this.page.inputPath);
    if (!registry.list.length) return "";

    const seenKeys = new Set();
    const items = registry.list.map(c => {
      const src = sourcesData[c.key];
      let citationText;
      if (!src) {
        citationText = `<em>⚠ Missing source key: "${c.key}" — check sources.json</em>`;
      } else if (seenKeys.has(c.key) && src.short_citation) {
        citationText = src.short_citation;
      } else {
        citationText = src.citation.replace(/\[NOTE TO SHANNON:.*?\]/gis, '').trim();
      }
      seenKeys.add(c.key);
      return `<li id="ref-${c.label}">
        <span class="ref-number">${c.label}.</span>
        <a href="#citeback-${c.label}" class="ref-backlink" aria-label="Back to text">↩</a>
        ${citationText}${c.detail ? ` <span class="ref-detail">[${c.detail}]</span>` : ""}
      </li>`;
    }).join("\n");

    return `<section class="person-section citations-section">
      <h2>References</h2>
      <ul class="references-list">${items}</ul>
    </section>`;
  });

  return {
    templateFormats: ["njk", "md", "html"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data"
    }
  };
};