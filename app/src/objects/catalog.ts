import type { Angles, Mesh3D, ObjectId } from '../math/types';
import { finishMesh } from './mesh3d';
import { loadGlbGeometry, type GlbSpec } from './loadGlb';

export type FigureView = {
  angles: Angles;
  sliceCount: number;
  size: number;
  sizeCompact?: number;
  extentScale: number;
};

export type CatalogEntry = {
  id: ObjectId;
  label: string;
  kind: 'polytope' | 'surface';
  iconSvg: string;
  creditHtml: string | null;
  view: FigureView;
  file: FigureFile;
};

type JsonMesh = {
  positions: number[][] | number[];
  indices: number[];
  edges?: Array<[number, number] | number[]>;
  wSpokes?: number[];
};

type FigureFile = {
  id: string;
  label: string;
  kind: CatalogEntry['kind'];
  icon?: string;
  mesh?: JsonMesh;
  glb?: GlbSpec;
  view?: {
    angles?: Partial<Record<keyof Angles, number>>;
    sliceCount?: number;
    size?: number;
    sizeCompact?: number;
    extentScale?: number;
  };
  credit?: { html?: string };
};

let entries: CatalogEntry[] = [];
let defaultId = '';
const cache = new Map<ObjectId, Mesh3D>();

function figuresBase(): string {
  return new URL(`${import.meta.env.BASE_URL}figures/`, document.baseURI).href;
}

function resolveFigureUrl(path: string): string {
  return new URL(path, figuresBase()).href;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function parseView(raw: FigureFile['view']): FigureView {
  const a = raw?.angles ?? {};
  const deg = (key: keyof Angles): number => (typeof a[key] === 'number' ? rad(a[key] as number) : 0);
  return {
    angles: {
      xy: deg('xy'),
      xz: deg('xz'),
      yz: deg('yz'),
      xw: deg('xw'),
      yw: deg('yw'),
      zw: deg('zw'),
    },
    sliceCount: typeof raw?.sliceCount === 'number' ? raw.sliceCount : 0,
    size: typeof raw?.size === 'number' ? raw.size : 1,
    sizeCompact: typeof raw?.sizeCompact === 'number' ? raw.sizeCompact : undefined,
    extentScale: typeof raw?.extentScale === 'number' ? raw.extentScale : 1,
  };
}

function isCompactLayout(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(max-width: 900px), (max-height: 520px)').matches;
}

async function loadEntry(id: string): Promise<CatalogEntry> {
  const file = await fetchJson<FigureFile>(resolveFigureUrl(`${id}.json`));
  const iconPath = file.icon ?? `icons/${id}.svg`;
  let iconSvg = '';
  try {
    const res = await fetch(resolveFigureUrl(iconPath));
    if (res.ok) iconSvg = await res.text();
  } catch {
    iconSvg = '';
  }
  return {
    id: file.id || id,
    label: file.label || id,
    kind: file.kind,
    iconSvg,
    creditHtml: file.credit?.html ?? null,
    view: parseView(file.view),
    file,
  };
}

export async function loadCatalog(): Promise<void> {
  const index = await fetchJson<{ default?: string; order: string[] }>(resolveFigureUrl('catalog.json'));
  if (!Array.isArray(index.order) || index.order.length === 0) {
    throw new Error('figures/catalog.json has no order');
  }
  entries = await Promise.all(index.order.map(loadEntry));
  defaultId = index.default && entries.some((e) => e.id === index.default)
    ? index.default
    : entries[0].id;
}

export function catalogEntries(): readonly CatalogEntry[] {
  return entries;
}

export function hasFigure(id: string): boolean {
  return entries.some((entry) => entry.id === id);
}

export function defaultFigureId(): string {
  return defaultId || entries[0]?.id || '';
}

export function getFigure(id: string): CatalogEntry {
  const hit = entries.find((entry) => entry.id === id);
  if (!hit) throw new Error(`Unknown figure: ${id}`);
  return hit;
}

export function figureAngles(id: string): Angles {
  return { ...getFigure(id).view.angles };
}

export function figureSliceCount(id: string): number {
  return getFigure(id).view.sliceCount;
}

export function figureObjectSize(id: string): number {
  const view = getFigure(id).view;
  if (view.sizeCompact !== undefined && isCompactLayout()) return view.sizeCompact;
  return view.size;
}

export function nextFigure(failedId: string, skip: Set<string>): string | null {
  skip.add(failedId);
  return entries.find((entry) => !skip.has(entry.id))?.id ?? null;
}

function flattenVecs(data: number[][] | number[], stride: number): Float32Array {
  if (data.length === 0) return new Float32Array(0);
  if (typeof data[0] === 'number') return Float32Array.from(data as number[]);
  const out = new Float32Array((data as number[][]).length * stride);
  for (let i = 0; i < (data as number[][]).length; i++) {
    const row = (data as number[][])[i];
    for (let k = 0; k < stride; k++) out[i * stride + k] = row[k];
  }
  return out;
}

function parseEdges(raw: JsonMesh['edges']): Array<[number, number]> | undefined {
  if (!raw) return undefined;
  return raw.map((pair) => [pair[0], pair[1]]);
}

function meshFromJson(entry: CatalogEntry): Mesh3D {
  const json = entry.file.mesh;
  if (!json) throw new Error(`${entry.id} has no mesh`);
  return finishMesh({
    id: entry.id,
    kind: entry.kind,
    label: entry.label,
    positions: flattenVecs(json.positions, 3),
    indices: Uint32Array.from(json.indices),
    uvs: null,
    texture: null,
    edges: parseEdges(json.edges),
    wSpokes: json.wSpokes,
    extentScale: entry.view.extentScale,
    creditHtml: entry.creditHtml,
  });
}

async function buildFigure(entry: CatalogEntry): Promise<Mesh3D> {
  if (entry.file.glb) {
    const geo = await loadGlbGeometry(entry.file.glb, resolveFigureUrl);
    return finishMesh({
      id: entry.id,
      kind: entry.kind,
      label: entry.label,
      positions: geo.positions,
      indices: geo.indices,
      uvs: geo.uvs,
      texture: geo.texture,
      extentScale: entry.view.extentScale,
      creditHtml: entry.creditHtml,
    });
  }
  return meshFromJson(entry);
}

export async function loadObject(id: ObjectId): Promise<Mesh3D> {
  const hit = cache.get(id);
  if (hit) return hit;
  const figure = await buildFigure(getFigure(id));
  cache.set(id, figure);
  return figure;
}
