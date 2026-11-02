
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const host = document.getElementById("yardCanvas");
const tooltip = document.getElementById("yardTooltip");

const scene = new THREE.Scene();
scene.background = new THREE.Color("#0b1520");
scene.fog = new THREE.Fog("#0b1520", 48, 105);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 250);
camera.position.set(45, 42, 65);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.45;
host.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 22;
controls.maxDistance = 120;
controls.maxPolarAngle = Math.PI / 2.12;
controls.target.set(0, 0, 0);

const ambient = new THREE.HemisphereLight(0xb5d9ff, 0x1a2830, 2.2);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffffff, 3.2);
sun.position.set(-18, 35, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
sun.shadow.normalBias = 0.025;
scene.add(sun);

const mat = (color, metalness = 0.15, roughness = 0.7) =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness });

const asphalt = mat("#18242c");
const concrete = mat("#354650");
const linePaint = mat("#d7b65b");
const darkMetal = mat("#15232c", 0.75, 0.36);
const silver = mat("#a7b8c2", 0.65, 0.35);
const glass = mat("#142f42", 0.45, 0.18);

function box(parent, w, h, d, material, x = 0, y = 0, z = 0, shadows = true) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    material
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// Ground and road
box(scene, 74, 0.45, 58, asphalt, 0, -0.3, 0, false);
box(scene, 74, 0.06, 10, concrete, 0, -0.035, 17, false);

for (let x = -33; x <= 33; x += 8) {
  box(scene, 3.8, 0.02, 0.14, linePaint, x, 0.01, 17, false);
}

// Warehouse
const warehouse = new THREE.Group();
warehouse.position.set(-24, 0, -18);
scene.add(warehouse);

box(warehouse, 13, 6, 9, mat("#293e49"), 0, 3, 0);
box(warehouse, 14, 0.45, 10, mat("#4a6170", 0.5), 0, 6.2, 0);

for (let i = -1; i <= 1; i++) {
  box(warehouse, 3.2, 3.4, 0.1, darkMetal, i * 4, 2.1, 4.55);
  for (let j = 0; j < 5; j++) {
    box(warehouse, 3.2, 0.04, 0.13, silver, i * 4, 0.8 + j * 0.58, 4.63);
  }
}

// Procedural text labels
function labelTexture(text, foreground = "#dcecf1") {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = foreground;
  ctx.font = "bold 52px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 17), 256, 64, 470);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeLabel(text, width = 3.1) {
  const material = new THREE.MeshBasicMaterial({
    map: labelTexture(text),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width / 4),
    material
  );
  return mesh;
}

const warehouseLabel = makeLabel("UPTIME WATCH", 7);
warehouseLabel.position.set(0, 5.25, 4.58);
warehouse.add(warehouseLabel);

// Status materials
const palette = {
  up: { base: "#245a51", light: "#19ef9a" },
  down: { base: "#74373c", light: "#ff626b" },
  unknown: { base: "#74603b", light: "#f8c75b" },
  stale: { base: "#455462", light: "#8ba1b3" },
};

function makeContainer(service, status, position) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.userData.service = service;
  scene.add(group);

  const colors = palette[status] || palette.stale;
  const body = mat(colors.base, 0.55, 0.46);
  const ribs = mat(colors.base, 0.7, 0.32);
  const trim = mat("#152a31", 0.8, 0.35);

  box(group, 4.2, 1.7, 1.75, body, 0, 0.85, 0);

  // Corrugated steel ribs
  for (let x = -1.94; x <= 1.94; x += 0.22) {
    box(group, 0.035, 1.53, 0.035, ribs, x, 0.85, 0.895);
    box(group, 0.035, 1.53, 0.035, ribs, x, 0.85, -0.895);
  }

  // Corner posts
  for (const x of [-2.07, 2.07]) {
    for (const z of [-0.86, 0.86]) {
      box(group, 0.11, 1.76, 0.11, trim, x, 0.85, z);
    }
  }

  // Small status indicator rather than painting everything neon
  const lightMaterial = new THREE.MeshBasicMaterial({
    color: colors.light,
  });

  box(group, 0.32, 0.09, 0.045, lightMaterial, 1.65, 1.45, 0.925);

  const name = makeLabel(service.name, 2.7);
  name.position.set(0, 0.88, 0.927);
  group.add(name);

  const hitbox = box(
    group, 4.3, 1.85, 1.9,
    new THREE.MeshBasicMaterial({
      visible: false,
    }),
    0, 0.85, 0,
    false
  );
  hitbox.userData.service = service;
  hitbox.userData.containerGroup = group;

  return group;
}

// 3D truck
const truck = new THREE.Group();
scene.add(truck);

const truckBody = mat("#d7e4e8", 0.35, 0.4);
const tireMaterial = mat("#10151a", 0.15, 0.9);

box(truck, 7.3, 0.38, 2.4, darkMetal, 0, 1.05, 0);
box(truck, 2.1, 2.1, 2.25, truckBody, 3, 2.1, 0);
box(truck, 0.1, 0.85, 1.75, glass, 4.1, 2.55, 0);

const trailerContainer = box(
  truck, 4.8, 2.25, 2.15,
  mat("#145b4b", 0.55, 0.42),
  -1.1, 2.32, 0
);

for (let x = -3.35; x < 1.2; x += 0.28) {
  box(truck, 0.035, 2.1, 0.04, mat("#287b66"), x, 2.32, 1.095);
}

const truckLabel = makeLabel("UPTIME WATCH", 3.5);
truckLabel.position.set(-1.1, 2.35, 1.11);
truck.add(truckLabel);

const wheels = [];

for (const x of [-2.7, -0.8, 3.15]) {
  for (const z of [-1.3, 1.3]) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.55, 0.28, 24),
      tireMaterial
    );
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, 0.65, z);
    wheel.castShadow = true;
    truck.add(wheel);
    wheels.push(wheel);

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.23, 0.23, 0.3, 20),
      silver
    );
    hub.rotation.x = Math.PI / 2;
    hub.position.set(x, 0.65, z);
    truck.add(hub);
  }
}

truck.position.set(-20, 0, 17);

// Raycasting and selection
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const hitboxes = [];
let hovered = null;
let selected = null;

function getPointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function intersect(event) {
  getPointer(event);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(hitboxes, false)[0]?.object || null;
}

renderer.domElement.addEventListener("pointermove", (event) => {
  const object = intersect(event);
  hovered = object;
  renderer.domElement.style.cursor = object ? "pointer" : "grab";

  if (object) {
    tooltip.hidden = false;
    tooltip.textContent = object.userData.service.name;
    const rect = host.getBoundingClientRect();
    tooltip.style.left = `${event.clientX - rect.left + 12}px`;
    tooltip.style.top = `${event.clientY - rect.top - 30}px`;
  } else {
    tooltip.hidden = true;
  }
});

renderer.domElement.addEventListener("pointerleave", () => {
  hovered = null;
  tooltip.hidden = true;
});

let downPoint = null;

renderer.domElement.addEventListener("pointerdown", (event) => {
  downPoint = { x: event.clientX, y: event.clientY };
});

renderer.domElement.addEventListener("pointerup", (event) => {
  if (!downPoint) return;

  const moved = Math.hypot(
    event.clientX - downPoint.x,
    event.clientY - downPoint.y
  );

  downPoint = null;
  if (moved > 5) return;

  const object = intersect(event);
  if (!object) return;

  selected = object.userData.service;

  window.dispatchEvent(new CustomEvent("uptime:select-service", {
    detail: { id: selected.id },
  }));
});

// Load actual dashboard data
async function loadData() {
  const response = await fetch(
    `./dashboard-data.json?t=${Date.now()}`,
    { cache: "no-store" }
  );

  if (!response.ok) throw new Error(`Data HTTP ${response.status}`);

  const data = await response.json();
  const checks = data.checks || [];
  const latestById = new Map();

  for (const check of checks) {
    for (const result of check.results || []) {
      latestById.set(result.id, {
        ...result,
        timestamp: check.timestamp,
      });
    }
  }

  return (data.services || []).map((service) => {
    const latest = latestById.get(service.id);
    const age = latest
      ? Date.now() - new Date(latest.timestamp).getTime()
      : Infinity;

    const status = age > 45 * 60000
      ? "stale"
      : latest?.status || "stale";

    return { service, status };
  });
}

const containerGroups = [];

function clearYard() {
  for (const group of containerGroups) {
    scene.remove(group);

    group.traverse((object) => {
      object.geometry?.dispose();

      if (object.material) {
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];

        for (const material of materials) {
          material.map?.dispose();
          material.dispose();
        }
      }
    });
  }

  containerGroups.length = 0;
  hitboxes.length = 0;
}

async function populateYard() {
  const entries = await loadData();

  clearYard();

  entries.forEach(({ service, status }, index) => {
    const col = index % 10;
    const row = Math.floor(index / 10);

    const x = (col - 4.5) * 5.2;
    const z = (row - 2) * 3.25 - 3.5;

    const container = makeContainer(
      service,
      status,
      new THREE.Vector3(x, 0.1, z)
    );

    containerGroups.push(container);

    const hitbox = container.children.find(
      (child) => child.userData.containerGroup
    );

    if (hitbox) hitboxes.push(hitbox);
  });
}

function refreshYard() {
  populateYard().catch((error) => {
    console.error("Unable to load 3D yard:", error);
    tooltip.hidden = false;
    tooltip.textContent = "3D service data unavailable";
  });
}

refreshYard();

window.addEventListener("uptime:data-updated", refreshYard);

// Resize and rendering
const resizeObserver = new ResizeObserver(() => {
  const width = host.clientWidth;
  const height = host.clientHeight;

  if (!width || !height) return;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
});

resizeObserver.observe(host);

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let visible = true;

const visibilityObserver = new IntersectionObserver(([entry]) => {
  visible = entry.isIntersecting;
}, { threshold: 0.05 });

visibilityObserver.observe(host);

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);

  if (!visible || document.hidden) return;

  if (!reducedMotion.matches) {
    truck.position.x += delta * 1.5;
    if (truck.position.x > 22) truck.position.x = -22;

    for (const wheel of wheels) {
      wheel.rotation.y -= delta * 2.6;
    }
  }

  controls.update();
  renderer.render(scene, camera);
}

animate();
