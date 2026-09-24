export type OsmType = 'node' | 'way' | 'relation';

/** Một kết quả của Nominatim /search (format=jsonv2, addressdetails=1). */
export interface NominatimResult {
  osm_type: OsmType;
  osm_id: number;
  lat: string;
  lon: string;
  name: string;
  display_name: string;
  category: string;
  type: string;
  addresstype: string;
  address?: Record<string, string>;
}

export interface LatLon {
  lat: number;
  lon: number;
}

/** Way thành viên của một relation ranh giới (Overpass `out geom`). */
export interface BoundaryWay {
  role: string;
  geometry: LatLon[];
}

/** Phần tử Overpass `out center tags`. */
export interface OverpassElement {
  type: OsmType;
  id: number;
  lat?: number;
  lon?: number;
  center?: LatLon;
  tags?: Record<string, string>;
}

export interface WikidataInfo {
  sitelinks: number;
  description: string | null;
}

/** [south, west, north, east] theo thứ tự Overpass dùng. */
export type Bbox = [number, number, number, number];
