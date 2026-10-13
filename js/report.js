/* ==========================================================================
   SIGEC — Formulario de reporte
   ========================================================================== */

const MAX_FILES = 3;
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED = /\.(jpe?g|png|webp)$/i;

const form = document.getElementById('report-form');
const fileInput = document.getElementById('imagenes');
const dropzone = document.getElementById('dropzone');
const previews = document.getElementById('previews');
const imgCount = document.getElementById('img-count');
const imgError = document.getElementById('err-imagenes');
const formAlert = document.getElementById('form-alert');
const submitBtn = document.getElementById('btn-submit');

/* ---------- Mapa político-administrativo de Panamá ---------- */
// Límites político-administrativos: Instituto Geográfico Nacional Tommy Guardia / MiAmbiente.
const MAP_DATA = 'assets/data/panama-corregimientos.geojson';
const panamaBounds = [[7.15, -83.15], [9.75, -77.05]];
const provinceSelect = document.getElementById('provincia');
const districtSelect = document.getElementById('distrito');
const corregimientoSelect = document.getElementById('corregimiento');
const mapLoading = document.getElementById('map-loading');
const mapError = document.getElementById('map-error');
const mapLevel = document.getElementById('map-level');
const mapInstruction = document.getElementById('map-instruction');
const mapMarkerHelp = document.getElementById('map-marker-help');
const mapReset = document.getElementById('map-reset');
let map;
let boundaryLayer;
let reportMarker;
let boundaryData;
let selectedProvince = '';
let selectedDistrict = '';
let selectedCorregimiento = '';

const normalizeName = (value) => String(value || '').trim();
const displayAreaName = (value) => normalizeName(value)
  .replace(/^Provincia de\s+/i, '')
  .replace(/^Distrito de\s+/i, '')
  .replace(/^Corregimiento de\s+/i, '')
  .replace(/^Corregimiento\s+/i, '');
const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
const featureNames = (feature) => ({
  province: displayAreaName(feature.properties.LMPR_NOMB),
  district: displayAreaName(feature.properties.LMDI_NOMB),
  corregimiento: displayAreaName(feature.properties.LMCO_NOMB),
});

function setOptions(select, values, placeholder) {
  select.replaceChildren(new Option(placeholder, ''), ...values.map((value) => new Option(value, value)));
}

function filteredFeatures(level) {
  if (!boundaryData) return [];
  return boundaryData.features.filter((feature) => {
    const names = featureNames(feature);
    if (level === 'province') return names.province === selectedProvince;
    if (level === 'district') return names.province === selectedProvince && names.district === selectedDistrict;
    return names.province === selectedProvince && names.district === selectedDistrict && names.corregimiento === selectedCorregimiento;
  });
}

function zoomToSelection(level) {
  const features = filteredFeatures(level);
  if (!features.length) return;
  const bounds = L.geoJSON({ type: 'FeatureCollection', features }).getBounds();
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28], maxZoom: level === 'corregimiento' ? 14 : 11 });
}

function markerIcon() {
  return L.divIcon({ className: 'report-location-marker', html: '<span class="report-location-marker__pin"></span>', iconSize: [30, 40], iconAnchor: [15, 37] });
}

function placeReportMarker(latlng, updateAddress = true) {
  if (!reportMarker) {
    reportMarker = L.marker(latlng, { icon: markerIcon(), keyboard: true, title: 'Ubicación obtenida del dispositivo' }).addTo(map);
  } else {
    reportMarker.setLatLng(latlng);
  }
  document.getElementById('lat').value = Number(latlng.lat).toFixed(6);
  document.getElementById('lng').value = Number(latlng.lng).toFixed(6);
  const locationInput = document.getElementById('ubicacion');
  if (updateAddress && !locationInput.value.trim()) {
    locationInput.value = `${selectedCorregimiento}, ${selectedDistrict}, ${selectedProvince}`;
    validateField(locationInput);
  }
  mapMarkerHelp.textContent = 'Ubicación del dispositivo confirmada para este reporte.';
  mapMarkerHelp.classList.add('is-ready');
}

function showMarkerForCorregimiento() {
  mapMarkerHelp.textContent = document.getElementById('lat').value
    ? 'Ubicación del dispositivo confirmada para este reporte.'
    : 'Usa la geolocalización del dispositivo para confirmar el punto del reporte.';
}

function updateMapState() {
  if (!boundaryLayer) return;
  boundaryLayer.setStyle((feature) => {
    const names = featureNames(feature);
    const inProvince = !selectedProvince || names.province === selectedProvince;
    const inDistrict = !selectedDistrict || names.district === selectedDistrict;
    const isCorregimiento = selectedCorregimiento && names.corregimiento === selectedCorregimiento && inDistrict;
    return {
      color: isCorregimiento ? '#075c35' : '#ffffff',
      weight: isCorregimiento ? 2.6 : (inProvince && inDistrict ? 1.15 : .35),
      fillColor: isCorregimiento ? '#16a05b' : (inProvince && inDistrict ? '#79c89e' : '#dcebe2'),
      fillOpacity: inProvince && inDistrict ? .72 : .32,
      opacity: inProvince ? 1 : .45,
    };
  });
  if (!selectedProvince) {
    mapLevel.textContent = 'Panamá · Selecciona una provincia';
    mapInstruction.textContent = 'Selecciona una provincia directamente sobre el mapa.';
  } else if (!selectedDistrict) {
    mapLevel.textContent = selectedProvince;
    mapInstruction.textContent = 'Ahora selecciona un distrito dentro de la provincia.';
  } else if (!selectedCorregimiento) {
    mapLevel.textContent = `${selectedProvince} · ${selectedDistrict}`;
    mapInstruction.textContent = 'Selecciona el corregimiento donde está la incidencia.';
  } else {
    mapLevel.textContent = `${selectedProvince} · ${selectedDistrict} · ${selectedCorregimiento}`;
    mapInstruction.textContent = 'Usa la geolocalización del dispositivo para confirmar el punto.';
  }
  mapReset.hidden = !selectedProvince;
}

function selectProvince(name, shouldZoom = true) {
  selectedProvince = name;
  selectedDistrict = selectedCorregimiento = '';
  provinceSelect.value = name;
  provinceSelect.setAttribute('aria-invalid', 'false');
  const districts = uniqueSorted(boundaryData.features.filter((f) => featureNames(f).province === name).map((f) => featureNames(f).district));
  setOptions(districtSelect, districts, 'Selecciona un distrito');
  districtSelect.disabled = false;
  setOptions(corregimientoSelect, [], 'Selecciona un distrito');
  corregimientoSelect.disabled = true;
  mapMarkerHelp.textContent = 'Usa la geolocalización del dispositivo para confirmar el punto del reporte.';
  mapMarkerHelp.classList.remove('is-ready');
  if (shouldZoom) zoomToSelection('province');
  updateMapState();
}

function selectDistrict(name, shouldZoom = true) {
  selectedDistrict = name;
  selectedCorregimiento = '';
  districtSelect.value = name;
  districtSelect.setAttribute('aria-invalid', 'false');
  setOptions(corregimientoSelect, uniqueSorted(filteredFeatures('district').map((f) => featureNames(f).corregimiento)), 'Selecciona un corregimiento');
  corregimientoSelect.disabled = false;
  if (shouldZoom) zoomToSelection('district');
  updateMapState();
}

function selectCorregimiento(name, shouldZoom = true) {
  selectedCorregimiento = name;
  corregimientoSelect.value = name;
  corregimientoSelect.setAttribute('aria-invalid', 'false');
  if (shouldZoom) zoomToSelection('corregimiento');
  updateMapState();
  showMarkerForCorregimiento();
}

function handleBoundaryClick(feature) {
  const names = featureNames(feature);
  if (!selectedProvince || names.province !== selectedProvince) return selectProvince(names.province);
  if (!selectedDistrict || names.district !== selectedDistrict) return selectDistrict(names.district);
  selectCorregimiento(names.corregimiento);
}

function resetMapSelection() {
  selectedProvince = selectedDistrict = selectedCorregimiento = '';
  provinceSelect.value = '';
  setOptions(districtSelect, [], 'Selecciona una provincia');
  setOptions(corregimientoSelect, [], 'Selecciona un distrito');
  districtSelect.disabled = corregimientoSelect.disabled = true;
  map.fitBounds(panamaBounds, { padding: [8, 8] });
  mapMarkerHelp.textContent = 'Usa la geolocalización del dispositivo para confirmar el punto del reporte.';
  mapMarkerHelp.classList.remove('is-ready');
  updateMapState();
}

async function initPanamaMap() {
  if (!window.L) throw new Error('Leaflet no está disponible.');
  map = L.map('panama-map', { zoomControl: true, minZoom: 6, maxZoom: 18, maxBounds: [[5.8, -84.3], [11, -75.8]] });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  map.fitBounds(panamaBounds, { padding: [8, 8] });
  const response = await fetch(MAP_DATA);
  if (!response.ok) throw new Error(`El servicio geográfico respondió ${response.status}.`);
  boundaryData = await response.json();
  boundaryLayer = L.geoJSON(boundaryData, {
    style: () => ({ color: '#fff', weight: .55, fillColor: '#79c89e', fillOpacity: .7 }),
    onEachFeature: (feature, layer) => {
      layer.bindTooltip(featureNames(feature).province, { sticky: true, direction: 'top' });
      layer.on({ click: () => handleBoundaryClick(feature), mouseover: () => layer.setStyle({ fillOpacity: .9, weight: 1.5 }), mouseout: updateMapState });
    },
  }).addTo(map);
  setOptions(provinceSelect, uniqueSorted(boundaryData.features.map((f) => featureNames(f).province)), 'Selecciona una provincia');
  mapLoading.hidden = true;
  updateMapState();
}

provinceSelect.addEventListener('change', () => provinceSelect.value ? selectProvince(provinceSelect.value) : resetMapSelection());
districtSelect.addEventListener('change', () => districtSelect.value && selectDistrict(districtSelect.value));
corregimientoSelect.addEventListener('change', () => corregimientoSelect.value && selectCorregimiento(corregimientoSelect.value));
mapReset.addEventListener('click', resetMapSelection);
initPanamaMap().catch((error) => {
  console.error(error);
  mapLoading.hidden = true;
  mapError.hidden = false;
});

/** Archivos seleccionados (se mantiene aparte del input para poder quitar uno a uno). */
let files = [];

/* ---------- Categoría preseleccionada desde la landing ---------- */
const preset = new URLSearchParams(location.search).get('categoria');
if (preset) {
  const radio = form.querySelector(`input[name="categoria"][value="${CSS.escape(preset)}"]`);
  if (radio) radio.checked = true;
}

/* ---------- Contador de descripción ---------- */
const desc = document.getElementById('descripcion');
const descCount = document.getElementById('desc-count');
desc.addEventListener('input', () => { descCount.textContent = `${desc.value.length} / 1000`; });

/* ---------- Geolocalización ---------- */
const locateBtn = document.getElementById('btn-locate');
const locateStatus = document.getElementById('locate-status');
locateBtn.addEventListener('click', () => {
  if (!('geolocation' in navigator)) {
    locateStatus.textContent = 'Tu navegador no permite obtener la ubicación.';
    return;
  }
  locateStatus.textContent = 'Obteniendo ubicación…';
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const lat = coords.latitude.toFixed(6);
      const lng = coords.longitude.toFixed(6);
      document.getElementById('lat').value = lat;
      document.getElementById('lng').value = lng;
      document.getElementById('precision').value = coords.accuracy.toFixed(2);
      const loc = document.getElementById('ubicacion');
      if (!loc.value.trim()) loc.value = `Coordenadas ${lat}, ${lng}`;
      locateStatus.textContent = `Ubicación añadida (precisión aprox. ${Math.round(coords.accuracy)} m).`;
      if (map) {
        const latlng = L.latLng(Number(lat), Number(lng));
        placeReportMarker(latlng, false);
        map.setView(latlng, 15);
      }
      validateField(loc);
    },
    () => { locateStatus.textContent = 'No se pudo obtener la ubicación. Debes permitir la geolocalización para continuar.'; },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

/* ---------- Imágenes ---------- */
function formatSize(bytes) {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function showImgError(msg) {
  imgError.querySelector('span').textContent = msg;
  imgError.classList.toggle('is-visible', Boolean(msg));
  dropzone.classList.toggle('is-invalid', Boolean(msg));
}

function addFiles(list) {
  const rejected = [];
  for (const file of list) {
    if (files.length >= MAX_FILES) { rejected.push(`Máximo ${MAX_FILES} imágenes.`); break; }
    if (!ALLOWED.test(file.name) && !/^image\/(jpeg|png|webp)$/.test(file.type)) {
      rejected.push(`"${file.name}" no es un formato permitido.`); continue;
    }
    if (file.size > MAX_SIZE) { rejected.push(`"${file.name}" supera los 5 MB.`); continue; }
    if (files.some((f) => f.name === file.name && f.size === file.size)) continue;
    files.push(file);
  }
  showImgError(rejected[0] || '');
  render();
}

function render() {
  previews.querySelectorAll('img').forEach((img) => URL.revokeObjectURL(img.src));
  previews.replaceChildren(...files.map((file, i) => {
    const li = document.createElement('li');
    li.className = 'preview';
    li.innerHTML = '<img alt="">';
    const img = li.querySelector('img');
    img.src = URL.createObjectURL(file);
    img.alt = file.name;
    const name = document.createElement('span');
    name.className = 'preview__name';
    name.textContent = `${file.name} · ${formatSize(file.size)}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'preview__remove';
    remove.setAttribute('aria-label', `Quitar ${file.name}`);
    remove.innerHTML = '<svg class="icon"><use href="#i-x"/></svg>';
    remove.addEventListener('click', () => {
      files.splice(i, 1);
      showImgError('');
      render();
      fileInput.focus();
    });
    li.append(name, remove);
    return li;
  }));
  imgCount.textContent = `${files.length} de ${MAX_FILES}`;
}

fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});

['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
  e.preventDefault();
  dropzone.classList.add('is-dragover');
}));
['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
  e.preventDefault();
  dropzone.classList.remove('is-dragover');
}));
dropzone.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

/* ---------- Validación ---------- */
const fieldMessages = {
  titulo: 'err-titulo',
  ubicacion: 'err-ubicacion',
  correo: 'err-correo',
};

function validateField(el) {
  const errId = fieldMessages[el.name];
  if (!errId) return true;
  const value = el.value.trim();
  let ok = el.checkValidity();
  if (el.required && !value) ok = false;
  el.setAttribute('aria-invalid', String(!ok));
  document.getElementById(errId).classList.toggle('is-visible', !ok);
  return ok;
}

// Validar al salir del campo y corregir en vivo una vez marcado como inválido
form.addEventListener('focusout', (e) => {
  if (fieldMessages[e.target.name] && (e.target.value || e.target.required)) validateField(e.target);
});
form.addEventListener('input', (e) => {
  if (e.target.getAttribute('aria-invalid') === 'true') validateField(e.target);
});
form.addEventListener('change', (e) => {
  if (e.target.name === 'categoria') document.getElementById('err-category').classList.remove('is-visible');
});

function validateAll() {
  const invalid = [];

  const category = form.querySelector('input[name="categoria"]:checked');
  document.getElementById('err-category').classList.toggle('is-visible', !category);
  if (!category) invalid.push(form.querySelector('input[name="categoria"]'));

  for (const select of [provinceSelect, districtSelect, corregimientoSelect]) {
    const ok = Boolean(select.value);
    select.setAttribute('aria-invalid', String(!ok));
    if (!ok) invalid.push(select);
  }

  for (const name of Object.keys(fieldMessages)) {
    const el = form.elements[name];
    if (!validateField(el)) invalid.push(el);
  }

  if (files.length < 1 || files.length > 3) {
    showImgError('Adjunta entre una y tres imágenes.');
    invalid.push(fileInput);
  }
  if (!document.getElementById('lat').value || !document.getElementById('lng').value || !document.getElementById('precision').value) {
    locateStatus.textContent = 'Debes obtener la ubicación del dispositivo antes de enviar.';
    invalid.push(locateBtn);
  }
  return invalid;
}

/* ---------- Envío ---------- */
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formAlert.hidden = true;

  const invalid = validateAll();
  if (invalid.length) {
    formAlert.textContent = 'Revisa los campos marcados antes de enviar.';
    formAlert.hidden = false;
    invalid[0].focus();
    invalid[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Procesando…';

  const suffix = String(Date.now()).slice(-5);
  document.getElementById('ticket-id').textContent = `SGC-${new Date().getFullYear()}-${suffix}`;
  document.getElementById('form-view').hidden = true;
  const success = document.getElementById('success-view');
  success.hidden = false;
  window.scrollTo({ top: 0 });
  success.focus();
});
