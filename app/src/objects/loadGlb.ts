import {
  BufferGeometry,
  ClampToEdgeWrapping,
  SRGBColorSpace,
  Texture,
  type BufferAttribute,
  type InterleavedBufferAttribute,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { dropInwardTriangles, normalizePositions } from './mesh3d';

export type GlbSpec = {
  url: string;
  normalize?: boolean;
  scale?: number;
  dropInward?: boolean;
};

export type GlbGeometry = {
  positions: Float32Array;
  indices: Uint32Array;
  uvs: Float32Array | null;
  texture: Texture | null;
};

function textureFromMaterial(material: unknown): Texture | null {
  if (!material || Array.isArray(material)) return null;
  const map = (material as { map?: Texture | null }).map;
  if (!map) return null;
  map.colorSpace = SRGBColorSpace;
  map.wrapS = ClampToEdgeWrapping;
  map.wrapT = ClampToEdgeWrapping;
  map.flipY = false;
  return map;
}

function attrArray(attr: BufferAttribute | InterleavedBufferAttribute, itemSize: number): Float32Array {
  const out = new Float32Array(attr.count * itemSize);
  for (let i = 0; i < attr.count; i++) {
    for (let k = 0; k < itemSize; k++) {
      out[i * itemSize + k] = attr.getComponent(i, k);
    }
  }
  return out;
}

export async function loadGlbGeometry(spec: GlbSpec, resolveUrl: (url: string) => string): Promise<GlbGeometry> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(resolveUrl(spec.url));
  const geometries: BufferGeometry[] = [];
  let texture: Texture | null = null;

  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((obj) => {
    const mesh = obj as {
      isMesh?: boolean;
      geometry?: BufferGeometry;
      material?: unknown;
      matrixWorld: import('three').Matrix4;
    };
    if (!mesh.isMesh || !mesh.geometry) return;
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrixWorld);
    geometries.push(geo);
    if (!texture) texture = textureFromMaterial(mesh.material);
  });

  if (geometries.length === 0) {
    throw new Error('GLB has no meshes');
  }

  const merged = geometries.length === 1
    ? geometries[0]
    : mergeGeometries(geometries, true);
  if (!merged) throw new Error('Could not merge GLB geometries');

  const positionAttr = merged.getAttribute('position');
  if (!positionAttr) throw new Error('GLB mesh has no positions');

  const positions = attrArray(positionAttr, 3);
  if (spec.normalize !== false) normalizePositions(positions);
  const scale = spec.scale ?? 1;
  if (scale !== 1) {
    for (let i = 0; i < positions.length; i++) positions[i] *= scale;
  }

  const rawIndex = merged.index
    ? Uint32Array.from(merged.index.array as ArrayLike<number>)
    : Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
  const indices = spec.dropInward ? dropInwardTriangles(positions, rawIndex) : rawIndex;

  const uvAttr = merged.getAttribute('uv');
  const uvs = uvAttr ? attrArray(uvAttr, 2) : null;

  return { positions, indices, uvs, texture };
}
