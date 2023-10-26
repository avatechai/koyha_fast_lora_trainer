function applyPreset(id, data) {
    data = JSON.parse(data)
  const form = document.getElementById(id);
  for (const key in data) {
    if (data.hasOwnProperty(key)) {
      const element = form.elements.namedItem(key);
      if (element) {
        element.value = data[key];
      }
    }
  }
}