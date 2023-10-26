async function applyPreset(id, key) {
  const data = await (await fetch(`./${key}.json`)).json();
  const form = document.getElementById(id);
  for (const key in data) {
    if (data.hasOwnProperty(key)) {
      const element = form.elements.namedItem(key);
      if (element) {
        if (typeof data[key] === "boolean") {
          element.checked = data[key];
        }
        element.value = data[key];
      }
    }
  }
}