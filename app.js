// ============================================
// 3D Name Tag Generator — Application Logic
// ============================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';

// ---- Constants (all in mm, 1 unit = 1 mm) ----
const TAG_HEIGHT = 25;        // mm
const TAG_DEPTH = 5;          // mm
const HOLE_RADIUS = 1.5;      // mm (3mm diameter)
const HOLE_SEGMENTS = 32;     // smoothness of hole cylinder
const TAG_PADDING_X = 5;      // mm padding on each side of text
const TAG_PADDING_HOLE = 5;   // mm extra padding on the left for the hole
const TEXT_SIZE = 12;          // mm font size
const TEXT_DEPTH = 2;          // mm extrusion depth of text
const TAG_CORNER_RADIUS = 3;  // mm corner radius for rounded rectangle

// ---- DOM Elements ----
const canvas = document.getElementById('threeCanvas');
const nameInput = document.getElementById('nameInput');
const charCount = document.getElementById('charCount');
const downloadBtn = document.getElementById('downloadBtn');
const resetCameraBtn = document.getElementById('resetCameraBtn');
const toggleWireframeBtn = document.getElementById('toggleWireframeBtn');
const dimensionInfo = document.getElementById('dimensionInfo');
const loadingOverlay = document.getElementById('loading-overlay');
const fontSelect = document.getElementById('fontSelect');
const btnRegular = document.getElementById('btnRegular');
const btnBold = document.getElementById('btnBold');

// ---- Three.js Setup ----
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
camera.position.set(0, 0, 80);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x0a0b0f, 1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

// ---- Controls ----
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.8;
controls.zoomSpeed = 1.2;
controls.panSpeed = 0.8;
controls.minDistance = 20;
controls.maxDistance = 200;

// ---- Lighting ----
const ambientLight = new THREE.AmbientLight(0x404060, 0.6);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
keyLight.position.set(30, 40, 50);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x8b90ff, 0.4);
fillLight.position.set(-20, 10, -30);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xa78bfa, 0.3);
rimLight.position.set(0, -20, -40);
scene.add(rimLight);

// Subtle environment
const envLight = new THREE.HemisphereLight(0x6c5ce7, 0x1a1d2b, 0.3);
scene.add(envLight);

// ---- Materials ----
const tagMaterial = new THREE.MeshStandardMaterial({
  color: 0x3a3f5c,
  roughness: 0.35,
  metalness: 0.6,
  side: THREE.DoubleSide,
});

const textMaterial = new THREE.MeshStandardMaterial({
  color: 0xa78bfa,
  roughness: 0.2,
  metalness: 0.8,
});

const wireframeMaterial = new THREE.MeshBasicMaterial({
  color: 0x6c5ce7,
  wireframe: true,
  transparent: true,
  opacity: 0.3,
});

// ---- State ----
let currentFont = null;
let tagGroup = null;
let isWireframe = false;
let currentFontName = 'helvetiker';
let currentFontWeight = 'regular';
let fontsCache = {};

// ---- Font Loading ----
const fontLoader = new FontLoader();
const FONT_BASE_URL = 'https://cdn.jsdelivr.net/npm/three@0.173.0/examples/fonts/';

function getFontUrl(name, weight) {
  return `${FONT_BASE_URL}${name}_${weight}.typeface.json`;
}

function loadFont(name, weight) {
  return new Promise((resolve, reject) => {
    const key = `${name}_${weight}`;
    if (fontsCache[key]) {
      resolve(fontsCache[key]);
      return;
    }
    fontLoader.load(
      getFontUrl(name, weight),
      (font) => {
        fontsCache[key] = font;
        resolve(font);
      },
      undefined,
      (err) => reject(err)
    );
  });
}

// ---- Rounded Rectangle Shape ----
function createRoundedRectShape(width, height, radius) {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  const r = Math.min(radius, width / 2, height / 2);

  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);

  return shape;
}

// ---- Create Hole via Shape (punch hole in the rounded rect) ----
function createTagShapeWithHole(width, height, radius, holeX, holeY, holeR) {
  const shape = createRoundedRectShape(width, height, radius);

  // Add hole as a path (counter-clockwise for subtraction)
  const holePath = new THREE.Path();
  holePath.absarc(holeX, holeY, holeR, 0, Math.PI * 2, true);
  shape.holes.push(holePath);

  return shape;
}

// ---- Build Name Tag ----
function buildNameTag(text) {
  // Remove old group
  if (tagGroup) {
    scene.remove(tagGroup);
    tagGroup.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
    });
  }

  if (!text || !currentFont) return;

  tagGroup = new THREE.Group();

  // ---- Create temporary text to measure width ----
  const tempTextGeo = new TextGeometry(text, {
    font: currentFont,
    size: TEXT_SIZE,
    depth: 0.1,
    curveSegments: 4,
  });
  tempTextGeo.computeBoundingBox();
  const textWidth = tempTextGeo.boundingBox.max.x - tempTextGeo.boundingBox.min.x;
  const textHeight = tempTextGeo.boundingBox.max.y - tempTextGeo.boundingBox.min.y;
  tempTextGeo.dispose();

  // ---- Calculate tag width ----
  const tagWidth = textWidth + TAG_PADDING_X * 2 + TAG_PADDING_HOLE;

  // ---- Hole position (centered vertically, on the left) ----
  const holeX = -tagWidth / 2 + TAG_PADDING_HOLE / 2 + HOLE_RADIUS + 1;
  const holeY = 0;

  // ---- Create tag body with hole ----
  const tagShape = createTagShapeWithHole(
    tagWidth, TAG_HEIGHT, TAG_CORNER_RADIUS,
    holeX, holeY, HOLE_RADIUS
  );

  const extrudeSettings = {
    depth: TAG_DEPTH,
    bevelEnabled: true,
    bevelThickness: 0.5,
    bevelSize: 0.5,
    bevelOffset: 0,
    bevelSegments: 3,
  };

  const tagGeometry = new THREE.ExtrudeGeometry(tagShape, extrudeSettings);
  const tagMesh = new THREE.Mesh(
    tagGeometry,
    isWireframe ? wireframeMaterial : tagMaterial
  );
  tagMesh.castShadow = true;
  tagMesh.receiveShadow = true;
  tagGroup.add(tagMesh);

  // ---- Create 3D text ----
  const textGeometry = new TextGeometry(text, {
    font: currentFont,
    size: TEXT_SIZE,
    depth: TEXT_DEPTH,
    curveSegments: 12,
    bevelEnabled: true,
    bevelThickness: 0.3,
    bevelSize: 0.2,
    bevelOffset: 0,
    bevelSegments: 3,
  });

  textGeometry.computeBoundingBox();
  const bb = textGeometry.boundingBox;
  const tw = bb.max.x - bb.min.x;
  const th = bb.max.y - bb.min.y;

  // Center text on the tag (offset to the right to account for hole area)
  const textOffsetX = -tw / 2 + TAG_PADDING_HOLE / 4;
  const textOffsetY = -th / 2;

  const textMesh = new THREE.Mesh(
    textGeometry,
    isWireframe ? wireframeMaterial : textMaterial
  );
  textMesh.position.set(textOffsetX, textOffsetY, TAG_DEPTH + 0.5);
  textMesh.castShadow = true;
  tagGroup.add(textMesh);

  // ---- Add ring around hole for visual appeal ----
  const ringGeometry = new THREE.TorusGeometry(HOLE_RADIUS + 0.5, 0.4, 16, 32);
  const ringMesh = new THREE.Mesh(
    ringGeometry,
    isWireframe ? wireframeMaterial : new THREE.MeshStandardMaterial({
      color: 0x6c5ce7,
      roughness: 0.3,
      metalness: 0.7,
    })
  );
  ringMesh.position.set(holeX, holeY, TAG_DEPTH / 2 + 0.5);
  tagGroup.add(ringMesh);

  // ---- Center the entire group ----
  scene.add(tagGroup);

  // ---- Update dimension info ----
  const actualWidth = tagWidth.toFixed(1);
  dimensionInfo.textContent = `${actualWidth} × ${TAG_HEIGHT} × ${TAG_DEPTH} mm`;

  // Enable download
  downloadBtn.disabled = false;
}

// ---- Export to STL ----
function exportSTL() {
  if (!tagGroup) return;

  const text = nameInput.value.trim();
  if (!text) return;

  // Build a temporary group with only the tag body and text (skip decorative ring)
  // using the exact same geometry as the preview
  const exportGroup = new THREE.Group();

  tagGroup.children.forEach((child) => {
    if (!child.isMesh) return;

    // Skip the decorative ring (TorusGeometry)
    if (child.geometry.type === 'TorusGeometry') return;

    // Clone mesh so we can bake its position into the geometry for export
    const clonedGeo = child.geometry.clone();
    clonedGeo.applyMatrix4(child.matrixWorld);

    const exportMesh = new THREE.Mesh(clonedGeo, new THREE.MeshBasicMaterial());
    exportGroup.add(exportMesh);
  });

  // Export
  const exporter = new STLExporter();
  const result = exporter.parse(exportGroup, { binary: true });

  // Cleanup cloned geometries
  exportGroup.children.forEach((child) => {
    if (child.geometry) child.geometry.dispose();
  });

  // Download
  const blob = new Blob([result], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `nametag_${text.replace(/\s+/g, '_').toLowerCase()}.stl`;
  link.click();
  URL.revokeObjectURL(url);

  // Button feedback animation
  downloadBtn.style.background = 'linear-gradient(135deg, #10b981 0%, #34d399 100%)';
  downloadBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
    Downloaded!
  `;
  setTimeout(() => {
    downloadBtn.style.background = '';
    downloadBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Download STL
    `;
  }, 2000);
}

// ---- Camera Reset ----
function resetCamera() {
  camera.position.set(0, 0, 80);
  controls.target.set(0, 0, 0);
  controls.update();
}

// ---- Toggle Wireframe ----
function toggleWireframe() {
  isWireframe = !isWireframe;
  toggleWireframeBtn.classList.toggle('active', isWireframe);
  buildNameTag(nameInput.value.trim());
}

// ---- Resize Handler ----
function handleResize() {
  const container = canvas.parentElement;
  const width = container.clientWidth;
  const height = container.clientHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

// ---- Animation Loop ----
function animate() {
  requestAnimationFrame(animate);
  controls.update();

  // Gentle auto-rotation when not interacting
  if (tagGroup && !controls.isDragging) {
    // Subtle floating animation
    tagGroup.position.y = Math.sin(Date.now() * 0.001) * 0.3;
  }

  renderer.render(scene, camera);
}

// ---- Debounce ----
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ---- Event Listeners ----
const debouncedBuild = debounce((text) => buildNameTag(text), 300);

nameInput.addEventListener('input', (e) => {
  const text = e.target.value;
  charCount.textContent = text.length;
  if (text.trim()) {
    debouncedBuild(text.trim());
  } else {
    if (tagGroup) {
      scene.remove(tagGroup);
      tagGroup = null;
    }
    downloadBtn.disabled = true;
    dimensionInfo.textContent = 'Enter text to generate';
  }
});

downloadBtn.addEventListener('click', exportSTL);
resetCameraBtn.addEventListener('click', resetCamera);
toggleWireframeBtn.addEventListener('click', toggleWireframe);

fontSelect.addEventListener('change', async (e) => {
  currentFontName = e.target.value;
  try {
    currentFont = await loadFont(currentFontName, currentFontWeight);
    buildNameTag(nameInput.value.trim());
  } catch (err) {
    console.error('Failed to load font:', err);
  }
});

btnRegular.addEventListener('click', async () => {
  currentFontWeight = 'regular';
  btnRegular.classList.add('active');
  btnBold.classList.remove('active');
  try {
    currentFont = await loadFont(currentFontName, currentFontWeight);
    buildNameTag(nameInput.value.trim());
  } catch (err) {
    console.error('Failed to load font:', err);
  }
});

btnBold.addEventListener('click', async () => {
  currentFontWeight = 'bold';
  btnBold.classList.add('active');
  btnRegular.classList.remove('active');
  try {
    currentFont = await loadFont(currentFontName, currentFontWeight);
    buildNameTag(nameInput.value.trim());
  } catch (err) {
    console.error('Failed to load font:', err);
  }
});

window.addEventListener('resize', handleResize);

// ---- Initialize ----
async function init() {
  handleResize();
  animate();

  try {
    currentFont = await loadFont(currentFontName, currentFontWeight);
    buildNameTag(nameInput.value.trim());
  } catch (err) {
    console.error('Failed to load font:', err);
    dimensionInfo.textContent = 'Font loading failed';
  }

  // Hide loading overlay
  loadingOverlay.classList.add('hidden');
}

init();
